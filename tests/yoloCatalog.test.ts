import { describe, expect, it } from 'vitest'
import { YOLO_CATALOG, YOLO_KIND_ORDER, YOLO_SCALE_ORDER } from '../src/shared/yoloCatalog'

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
      const inferred =
        idFromFile.toLowerCase().includes('seg') ? 'segment'
        : idFromFile.toLowerCase().includes('pose') ? 'pose'
        : 'detect'
      expect(inferred).toBe(m.kind)
    }
  })
})
