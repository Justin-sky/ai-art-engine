import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 生成能力缝的接线完整性契约。
 *
 * 图节点只能通过 `NodeExecuteContext` 上的 `generate*` 缝调用模型（禁止直连 HTTP）。
 * 一条缝要真正可用，需要**三处**同时接上，缺任何一处都表现为节点运行时报
 * `GRAPH_*_UNAVAILABLE` 这类「能力未注入」错误：
 *
 *   1. 类型声明：`NodeExecuteContext`（execute/types.ts）里有这个成员；
 *   2. 引擎中转：`engine.ts` 组装 ctx 时把它从 options 抄进去 —— **最容易漏的一处**；
 *   3. 注入点：每个把 run options 交给引擎的地方都提供实现
 *      （画布直跑 NodeGraphEditor 与后台队列 graphTasks 是两份独立 options）。
 *
 * 决策判定节点把第 3 处（画布直跑漏接）与第 2 处（引擎没中转）各踩了一遍，
 * 而两者症状完全一样，所以三处都要断言。
 */

const RENDERER_SRC = join(process.cwd(), 'src/renderer/src')
const ENGINE = join(process.cwd(), 'src/shared/graph/execute/engine.ts')
const EXECUTE_TYPES = join(process.cwd(), 'src/shared/graph/execute/types.ts')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|vue)$/.test(entry)) out.push(full)
  }
  return out
}

/** 把 run options 交给图引擎的文件（而非 preload 桥、IPC 类型声明等） */
function runOptionsSources(): Array<{ file: string; src: string }> {
  return walk(RENDERER_SRC)
    .map((file) => ({ file, src: readFileSync(file, 'utf8') }))
    .filter(
      ({ src }) =>
        src.includes('generateText:') &&
        (src.includes('runGraph(') || src.includes('useGraphRunSession('))
    )
    .map(({ file, src }) => ({ file: relative(RENDERER_SRC, file).replace(/\\/g, '/'), src }))
}

describe('生成能力缝接线完整性', () => {
  const engine = readFileSync(ENGINE, 'utf8')
  const executeTypes = readFileSync(EXECUTE_TYPES, 'utf8')

  it('至少发现画布直跑与任务队列两处注入点（防止扫描失效后空跑通过）', () => {
    const files = runOptionsSources().map((s) => s.file)
    expect(files).toContain('components/NodeGraphEditor.vue')
    expect(files).toContain('stores/graphTasks.ts')
  })

  it('NodeExecuteContext 声明了 generateDecisions，且引擎把它从 options 中转进 ctx', () => {
    // 1) 类型声明
    expect(executeTypes).toMatch(/generateDecisions\?:/)
    // 2) 引擎中转：漏这句时注入点接得再对，ctx 里也是 undefined
    expect(engine).toMatch(
      /const ctx: NodeExecuteContext = \{[\s\S]*?generateDecisions: options\.generateDecisions/
    )
  })

  it('每个注入点都提供 generateDecisions 实现（否则决策节点报 GRAPH_DECISIONS_UNAVAILABLE）', () => {
    for (const { file, src } of runOptionsSources()) {
      expect(src, `${file} 缺少 generateDecisions 能力缝`).toContain('generateDecisions')
    }
  })

  it('提供实现的一侧必须接到 window.studio.generateDecisions（禁止绕过适配器直连 HTTP）', () => {
    const callers = runOptionsSources().filter(({ src }) =>
      src.includes('window.studio.generateText')
    )
    expect(callers.map((c) => c.file).sort()).toEqual(
      expect.arrayContaining(['components/NodeGraphEditor.vue', 'stores/graphTasks.ts'])
    )
    for (const { file, src } of callers) {
      expect(src, `${file} 未接到 window.studio.generateDecisions`).toContain(
        'window.studio.generateDecisions'
      )
      expect(src, `${file} 的能力缝疑似直连 HTTP`).not.toMatch(
        /generateDecisions[\s\S]{0,200}(fetch\(|axios\.)/
      )
    }
  })

  /**
   * 引擎中转是所有缝的通用要求，不只决策这一条：
   * NodeExecuteContext 上每个 generate* 成员，凡是 GraphRunOptions 也有的，
   * 都必须被 engine 抄进 ctx。
   */
  it('引擎中转了所有 generate* 缝（通用防漏）', () => {
    const declared = [...executeTypes.matchAll(/^\s{2}(generate[A-Za-z0-9]*)\??:/gm)].map(
      (m) => m[1]!
    )
    expect(new Set(declared).size).toBeGreaterThan(3)
    // 只看 GraphRunOptions 里也声明了的那些（即确实由 options 传入的）
    const runOptionsBlock = engine.split('const ctx: NodeExecuteContext')[0]!
    const missing = [...new Set(declared)].filter(
      (name) =>
        new RegExp(`${name}\\?:`).test(runOptionsBlock) &&
        !new RegExp(`${name}: options\\.${name}`).test(engine)
    )
    expect(missing, `engine.ts 未中转这些缝：${missing.join(', ')}`).toEqual([])
  })
})
