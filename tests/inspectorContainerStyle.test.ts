import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * inspector 的容器样式不是全局定义的：每个组件自己声明
 * `.node-inspector { display:flex; gap:12px; padding:12px; height:100%; overflow:auto }`。
 * 漏掉这段时面板内容会直接贴到边缘（新增的模型后处理 / 拆分 inspector 就踩过这个坑），
 * 这里把「渲染了 node-inspector 就必须自带容器内边距」做成不变量守住。
 */
function registeredInspectorComponents(): string[] {
  const builtins = readFileSync(resolve('src/renderer/src/inspector/builtins.ts'), 'utf8')
  const names = [...builtins.matchAll(/from '\.\.\/components\/([^']+\.vue)'/g)].map((m) => m[1]!)
  return [...new Set(names)].filter((name) =>
    existsSync(resolve('src/renderer/src/components', name))
  )
}

describe('inspector 容器样式', () => {
  it('每个渲染 .node-inspector 的组件都声明了容器内边距与行距', () => {
    const offenders: string[] = []
    for (const file of registeredInspectorComponents()) {
      const src = readFileSync(resolve('src/renderer/src/components', file), 'utf8')
      if (!/class="node-inspector/.test(src)) continue
      const block = /\.node-inspector\s*\{([^}]*)\}/.exec(src)?.[1] ?? ''
      // 内边距是重点（漏了就贴边）；行距允许 10/12 两种既有口径
      if (!/padding:\s*12px/.test(block) || !/gap:\s*\d+px/.test(block)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })

  it('模型加工 inspector 与 rigSkin 同口径（含 empty 态）', () => {
    for (const file of ['ModelPostProcessInspector.vue', 'ModelSegmentInspector.vue']) {
      const src = readFileSync(resolve('src/renderer/src/components', file), 'utf8')
      const block = /\.node-inspector\s*\{([^}]*)\}/.exec(src)?.[1] ?? ''
      expect(block, `${file} 缺 .node-inspector 容器样式`).toMatch(/padding:\s*12px/)
      expect(block, `${file} 缺容器行距`).toMatch(/gap:\s*12px/)
      expect(block, `${file} 缺高度/滚动约束`).toMatch(/height:\s*100%/)
      expect(block, `${file} 缺溢出滚动`).toMatch(/overflow:\s*auto/)
      expect(src, `${file} 缺空态样式`).toMatch(/\.node-inspector\.empty/)
    }
  })
})
