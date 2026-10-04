import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 人像处理 inspector 的输出预览接线（源码文本断言）。
 *
 * 预览用的是全仓统一的 `GraphNodeOutputPreview`（缩略图 / 全屏 / 存资产库 / 多版本点选），
 * 它按 `hostId` 去取宿主图与 runStates，并且自己有「最新产物优先、退化到 previewRelativePath」
 * 的取值口径。接线漏一处不会报错，只会「预览永远空白」——所以在这里锁住关键几行。
 */

const ROOT = join(__dirname, '..')
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8')

describe('人像处理 inspector 输出预览', () => {
  const source = read('src/renderer/src/components/PortraitInspector.vue')

  it('挂的是统一输出预览组件（不是自己拼一个 img）', () => {
    expect(source).toContain("import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'")
    expect(source).toMatch(
      /<GraphNodeOutputPreview v-if="node && hostId" :node="node" :host-id="hostId" \/>/
    )
    // 排在提示词预览之前：产物比提示词更该先看到
    expect(source.indexOf('GraphNodeOutputPreview')).toBeLessThan(
      source.indexOf('class="prompt-box"')
    )
  })

  it('hostId 跟着当前选中的节点走（取不到宿主就不渲染）', () => {
    expect(source).toMatch(/const hostId = computed\(\(\) => \{/)
    expect(source).toMatch(
      /selection\.kind === 'graph\.node' \? \(selection\.hostId \?\? ''\) : ''/
    )
  })

  it('节点按 revision 活读，跑完图后预览自己就刷新', () => {
    expect(source).toContain('void graphEditorHosts.revision.value')
    expect(source).toMatch(/graphEditorHosts\.getNode\(selection\.hostId, id\)/)
  })
})
