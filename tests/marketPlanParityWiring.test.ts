import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 官方工作流的 plan 是**两份拷贝**：应用内置预设（构建期）与市场仓库（下载）。
 * `scripts/export-market-workflows.mjs` 把"人手同步"换成"导出 + 校验"，这个文件盯的是
 * **它有没有被悄悄摘掉** —— 摘掉不会报错，只会让两份拷贝各自漂移，而失败形态是
 * 「同名同版本的两张不同的图」，两边都不报错。
 */

const ROOT = resolve(__dirname, '..')
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8')

describe('市场 plan 平价守卫的接线', () => {
  it('导出脚本存在', () => {
    expect(existsSync(resolve(ROOT, 'scripts/export-market-workflows.mjs'))).toBe(true)
  })

  it('package.json 提供导出与校验两条入口', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
    expect(pkg.scripts['export:market']).toContain('export-market-workflows.mjs')
    expect(pkg.scripts['check:market-plans']).toContain('export-market-workflows.mjs')
    // 校验入口必须带 --check：否则 CI 会"检查"完顺手把市场仓库改了
    expect(pkg.scripts['check:market-plans']).toContain('--check')
  })

  it('CI 真的会跑它，并且拉得到市场仓库', () => {
    const ci = read('.github/workflows/ci.yml')
    expect(ci, 'CI 必须跑平价校验').toContain('export-market-workflows.mjs --check')
    expect(ci, 'CI 必须把市场仓库拉下来（脚本只读本地目录）').toContain('ai-art-engine-workflow')
    // 网络步骤要有重试，否则会把偶发抖动当成漂移
    expect(ci).toMatch(/for attempt in 1 2 3/)
  })

  it('节点类型用的是共享派生函数，不在脚本里再抄一遍口径', () => {
    const script = read('scripts/export-market-workflows.mjs')
    // 与市场仓库 validate.mjs 的 nodeTypesOfPlan 同一口径；手抄会漂移
    expect(script).toContain('nodeTypesOfPlan')
    expect(script).toContain("from './src/shared/workflowMarket'")
  })

  it('只写 plan 与 requires.nodeTypes，不碰元数据/封面/技能包', () => {
    const script = read('scripts/export-market-workflows.mjs')
    expect(script).toContain("findTopLevelValue(raw, 'plan')")
    expect(script).toContain("findTopLevelValue(next, 'requires')")
    // 定点替换：整份 JSON 重新序列化会把手写字段（元数据、格式）也一并重排
    expect(script).not.toContain('JSON.stringify(parsed, null, 2)')
  })
})
