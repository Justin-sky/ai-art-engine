import { describe, expect, it } from 'vitest'
import {
  imageToViewportPoint,
  viewportPointToImage,
  type PortraitViewport
} from '../src/renderer/src/features/graph/model/portraitViewportTransform'

/**
 * 人像编辑器的视口变换数学。
 *
 * 这里的公式错了不会报错，表现只是「画的框落在别处」「拖分割线时线跟不上指针」。
 * 源码文本断言锁不住公式（第一版就把错误的分母 `naturalWidth` 锁进了测试），所以这里做数值断言：
 * 往返一致性 + 几条能直接换算的边界值。
 */

const BASE: PortraitViewport = {
  layoutWidth: 800,
  layoutHeight: 600,
  centerX: 400,
  centerY: 300,
  zoom: 1,
  rotationDeg: 0
}

describe('portraitViewportTransform', () => {
  it('未缩放未旋转：图片中心落在视口中心，四角按布局尺寸铺开', () => {
    expect(imageToViewportPoint({ x: 0.5, y: 0.5 }, BASE)).toEqual({ x: 400, y: 300 })
    expect(imageToViewportPoint({ x: 0, y: 0 }, BASE)).toEqual({ x: 0, y: 0 })
    expect(imageToViewportPoint({ x: 1, y: 1 }, BASE)).toEqual({ x: 800, y: 600 })
  })

  it('缩放 2 倍：图片右边缘在中心右侧 layoutWidth × zoom / 2 = 800px 处', () => {
    const view: PortraitViewport = { ...BASE, zoom: 2 }
    expect(imageToViewportPoint({ x: 1, y: 0.5 }, view).x).toBeCloseTo(1200, 6)
    // 用原始像素（naturalWidth = 3000）当分母的话这里会得到 0.7 而不是 1
    expect(viewportPointToImage({ x: 1200, y: 300 }, view).x).toBeCloseTo(1, 6)
  })

  it('分母是布局尺寸而不是原始像素：指针横穿全图，比例必须走满 0 → 1', () => {
    const view: PortraitViewport = { ...BASE, zoom: 2, layoutWidth: 800, layoutHeight: 600 }
    const left = viewportPointToImage({ x: view.centerX - 800, y: 300 }, view)
    const right = viewportPointToImage({ x: view.centerX + 800, y: 300 }, view)
    expect(left.x).toBeCloseTo(0, 6)
    expect(right.x).toBeCloseTo(1, 6)
    const middle = viewportPointToImage({ x: view.centerX, y: 300 }, view)
    expect(middle.x).toBeCloseTo(0.5, 6)
  })

  it('旋转 90°：图片的 x 轴映射到视口的 y 轴', () => {
    const view: PortraitViewport = { ...BASE, rotationDeg: 90 }
    const point = imageToViewportPoint({ x: 1, y: 0.5 }, view)
    // 顺时针 90°：右边缘转到中心的正下方，长度 = layoutWidth / 2
    expect(point.x).toBeCloseTo(400, 6)
    expect(point.y).toBeCloseTo(700, 6)
  })

  it('往返一致：任意 zoom / 角度 / 平移下都回到原归一化坐标', () => {
    const view: PortraitViewport = {
      layoutWidth: 1234,
      layoutHeight: 777,
      centerX: 512.5,
      centerY: 288.25,
      zoom: 2.75,
      rotationDeg: 37
    }
    for (const point of [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 1 },
      { x: 0.123, y: 0.876 }
    ]) {
      const viewport = imageToViewportPoint(point, view)
      const back = viewportPointToImage(viewport, view)
      expect(back.x).toBeCloseTo(point.x, 6)
      expect(back.y).toBeCloseTo(point.y, 6)
    }
  })

  it('zoom 为 0 时按 1 处理，不产生 NaN / Infinity', () => {
    const point = viewportPointToImage({ x: 100, y: 100 }, { ...BASE, zoom: 0 })
    expect(Number.isFinite(point.x)).toBe(true)
    expect(Number.isFinite(point.y)).toBe(true)
    expect(point.x).toBeCloseTo((100 - 400) / 800 + 0.5, 6)
  })
})
