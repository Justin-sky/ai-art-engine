import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 图片预览弹窗（`MediaPreviewDialog` → `EditorDiveMediaPreview`）的旋转接线。
 *
 * 为什么用源码文本断言：转错了不会报错 —— 少叠一层 `rotate()` 就是「点了没反应」，
 * 复位时忘了带上角度就是「点了复位还歪着」，而这两处都只有人对着屏幕才发现。
 */

const ROOT = join(__dirname, '..')
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8')

describe('图片预览弹窗旋转', () => {
  const source = read('src/renderer/src/components/dive/EditorDiveMediaPreview.vue')

  it('旋转与缩放 / 平移叠在同一个 transform 上', () => {
    expect(source).toMatch(
      /transform: `translate\(\$\{offsetX\.value\}px, \$\{offsetY\.value\}px\) scale\(\$\{scale\.value\}\) rotate\(\$\{rotationDeg\.value\}deg\)`/
    )
    expect(source).toMatch(/const rotationDeg = ref\(0\)/)
  })

  it('工具条只在图片就绪时出现，且不落在 viewport 里（否则点一下就被复位）', () => {
    const bar =
      /<div v-if="isImageReady" class="image-bar" @click\.stop>([\s\S]*?)\n    <\/div>/.exec(source)
    expect(bar, 'image-bar 不见了').toBeTruthy()
    // 三颗控件：逆时针 / 顺时针 / 复位角
    expect(bar![1]).toContain('@click="rotateBy(-90)"')
    expect(bar![1]).toContain('@click="rotateBy(90)"')
    expect(bar![1]).toContain('@click="resetRotation"')
    expect(bar![1]).toContain('rotationLabel')
    expect(bar![1]).toContain("t('graph.preview.rotateCcw')")
    expect(bar![1]).toContain("t('graph.preview.rotateCw')")
    expect(bar![1]).toContain("t('graph.preview.rotateReset')")
    // 工具条必须是 viewport 的兄弟节点：viewport 的点击 = 复位视图
    expect(source.indexOf('class="image-bar"')).toBeGreaterThan(
      source.indexOf('class="av-player audio"')
    )
    expect(source).toContain('const isImageReady = computed')
  })

  it('三路入口齐全：按钮 / 键盘 / Shift+滚轮，且键盘不冒泡给画布', () => {
    expect(source).toContain('function rotateBy(')
    // 归一化到 [0, 360)，连点不会堆出 720 / -90
    expect(source).toMatch(/rotationDeg\.value = \(rotationDeg\.value \+ deg \+ 360\) % 360/)
    // 键盘：[ / ] 整步 90°、0 复位
    const keydown = /function onKeydown\([\s\S]*?\n\}/.exec(source)
    expect(keydown, 'onKeydown 不见了').toBeTruthy()
    expect(keydown![0]).toContain("event.key === '['")
    expect(keydown![0]).toContain("event.key === ']'")
    expect(keydown![0]).toContain("event.key === '0'")
    expect(keydown![0]).toContain('event.preventDefault()')
    expect(keydown![0]).toContain('event.stopPropagation()')
    expect(source).toContain('@keydown="onKeydown"')
    // Shift+滚轮细调
    expect(source).toMatch(/function onWheel\([\s\S]*?e\.shiftKey[\s\S]*?rotateBy\(/)
  })

  it('复位带上旋转角，且换图不继承上一张的角度', () => {
    const resetView = /function resetView\(\)[\s\S]*?\n\}/.exec(source)
    expect(resetView, 'resetView 不见了').toBeTruthy()
    expect(resetView![0]).toContain('rotationDeg.value = 0')
    // 点空白处复位走同一个 resetView
    expect(source).toMatch(/function onBackdropClick\([\s\S]*?resetView\(\)/)
    // 弹窗是复用的：换 url / relativePath / mediaKind 时把视图归零
    expect(source).toMatch(
      /watch\(\s*\(\) => \[props\.url, props\.relativePath, props\.mediaKind\] as const,[\s\S]*?resetView\(\)/
    )
  })

  it('旋转文案中英齐全', () => {
    for (const file of [
      'src/renderer/src/i18n/locales/zh-CN.ts',
      'src/renderer/src/i18n/locales/en-US.ts'
    ]) {
      const locale = read(file)
      for (const key of ['imageHint:', 'rotateCcw:', 'rotateCw:', 'rotateReset:']) {
        expect(locale, `${file} 缺 ${key}`).toContain(key)
      }
    }
  })
})
