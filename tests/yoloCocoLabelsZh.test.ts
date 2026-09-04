import { describe, expect, it } from 'vitest'
import { YOLO_COCO_LABELS, YOLO_COCO_LABELS_ZH, cocoLabelZh } from '../src/shared/yolo'

describe('YOLO COCO 中英文标签字典', () => {
  it('中英文数组一一对应且为 80 类', () => {
    expect(YOLO_COCO_LABELS.length).toBe(80)
    expect(YOLO_COCO_LABELS_ZH.length).toBe(YOLO_COCO_LABELS.length)
  })

  it('中文名无重复、无空串', () => {
    expect(new Set(YOLO_COCO_LABELS_ZH).size).toBe(YOLO_COCO_LABELS_ZH.length)
    for (const zh of YOLO_COCO_LABELS_ZH) {
      expect(zh.length).toBeGreaterThan(0)
    }
  })

  it('cocoLabelZh 能映射已知标签并透传未知标签', () => {
    expect(cocoLabelZh('person')).toBe('人物')
    expect(cocoLabelZh('car')).toBe('汽车')
    expect(cocoLabelZh('surfboard')).toBe('冲浪板')
    expect(cocoLabelZh('dining table')).toBe('餐桌')
    expect(cocoLabelZh('unknown-class')).toBe('unknown-class')
  })
})
