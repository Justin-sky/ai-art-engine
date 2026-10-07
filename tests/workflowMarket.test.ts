import { describe, expect, it } from 'vitest'
import {
  WORKFLOW_MARKET_CATEGORIES,
  WORKFLOW_MARKET_SCHEMA_VERSION,
  compareSemver,
  missingNodeTypes,
  nodeTypesOfPlan,
  parseWorkflowBundle,
  parseWorkflowMarketEntry,
  parseWorkflowMarketIndex,
  workflowCategoryKey,
  workflowEntryBlockReason,
  workflowMarketUrls
} from '../src/shared/workflowMarket'
import { listNodeTypes } from '../src/shared/graph'

/**
 * 远端工作流市场的契约（纯函数）。
 *
 * 重点在两件事：
 * 1. **宽容读取、严格拒绝** —— 单条坏条目只丢一条并计数（一个坏条目不该让整个市场空白），
 *    但整体结构崩坏要整体失败，避免半渲染成一个误导性的空市场。
 * 2. **兼容性** —— 工作流引用节点类型，旧版应用拿到引用新类型的工作流会落出残图，
 *    所以「缺哪些类型」必须在安装/使用前判定，不能依赖物化时的 warning 兜底。
 */

const goodEntry = {
  id: 'short-drama-9grid',
  title: '短剧分镜（9宫格直出）',
  titleEn: 'Short drama (9-grid)',
  summary: '剧本 → 9宫格分镜表 → 切格出帧',
  category: 'film',
  tags: ['短剧', '分镜'],
  version: '1.0.0',
  author: { name: 'kal-', url: 'https://github.com/kal' },
  license: 'CC-BY-4.0',
  cover: 'cover.png',
  requires: { nodeTypes: ['asset.text', 'asset.image'], appMinVersion: '7.1.0' },
  nodeCount: 7,
  edgeCount: 6,
  sizeBytes: 8123
}

const goodPlan = {
  title: '短剧分镜（9宫格直出）',
  nodes: [
    { key: 'script', typeId: 'asset.text', params: { text: 'x' } },
    { key: 'grid', typeId: 'asset.image', params: {} }
  ],
  edges: [{ from: 'script', to: 'grid' }]
}

const goodBundle = {
  schemaVersion: 1,
  id: 'short-drama-9grid',
  title: '短剧分镜（9宫格直出）',
  summary: '剧本 → 9宫格分镜表 → 切格出帧',
  category: 'film',
  version: '1.0.0',
  author: { name: 'kal-' },
  license: 'CC-BY-4.0',
  requires: { nodeTypes: ['asset.text', 'asset.image'] },
  plan: goodPlan
}

function indexWith(workflows: unknown[]): unknown {
  return { schemaVersion: 1, generatedAt: '2026-10-07T00:00:00Z', workflows }
}

describe('parseWorkflowMarketEntry：缺署名/许可的条目在解析层就被挡', () => {
  it('正常条目完整解析', () => {
    const entry = parseWorkflowMarketEntry(goodEntry)
    expect(entry?.id).toBe('short-drama-9grid')
    expect(entry?.category).toBe('film')
    expect(entry?.author).toEqual({ name: 'kal-', url: 'https://github.com/kal' })
    expect(entry?.requires.nodeTypes).toEqual(['asset.image', 'asset.text']) // 去重并排序
    expect(entry?.nodeCount).toBe(7)
  })

  it('id 必须 kebab-case', () => {
    expect(parseWorkflowMarketEntry({ ...goodEntry, id: 'Bad Id' })).toBeNull()
    expect(parseWorkflowMarketEntry({ ...goodEntry, id: 'a/b' })).toBeNull()
    expect(parseWorkflowMarketEntry({ ...goodEntry, id: '-lead' })).toBeNull()
    expect(parseWorkflowMarketEntry({ ...goodEntry, id: '' })).toBeNull()
  })

  it('version 必须 semver 形态', () => {
    expect(parseWorkflowMarketEntry({ ...goodEntry, version: '1.0' })).toBeNull()
    expect(parseWorkflowMarketEntry({ ...goodEntry, version: 'v1.0.0' })).toBeNull()
    expect(parseWorkflowMarketEntry({ ...goodEntry, version: '1.0.0-beta.1' })?.version).toBe(
      '1.0.0-beta.1'
    )
  })

  it('**缺 author 或 license 一律拒绝**（审核底线：无署名/无许可的内容有法律灰区）', () => {
    expect(parseWorkflowMarketEntry({ ...goodEntry, author: undefined })).toBeNull()
    expect(parseWorkflowMarketEntry({ ...goodEntry, author: { name: '  ' } })).toBeNull()
    expect(parseWorkflowMarketEntry({ ...goodEntry, license: '' })).toBeNull()
    expect(parseWorkflowMarketEntry({ ...goodEntry, license: undefined })).toBeNull()
  })

  it('author 允许写成裸字符串', () => {
    expect(parseWorkflowMarketEntry({ ...goodEntry, author: 'kal-' })?.author).toEqual({
      name: 'kal-'
    })
  })

  it('缺 title / summary 拒绝（卡片没有可展示的主文案）', () => {
    expect(parseWorkflowMarketEntry({ ...goodEntry, title: '' })).toBeNull()
    expect(parseWorkflowMarketEntry({ ...goodEntry, summary: '   ' })).toBeNull()
  })

  it('未知分类落到 utility 而不是整条作废（分类只是筛选维度）', () => {
    expect(parseWorkflowMarketEntry({ ...goodEntry, category: 'unknown' })?.category).toBe(
      'utility'
    )
    expect(parseWorkflowMarketEntry({ ...goodEntry, category: undefined })?.category).toBe(
      'utility'
    )
  })

  it('缺 requires 时给空 nodeTypes（表示未声明，不当作非法）', () => {
    expect(parseWorkflowMarketEntry({ ...goodEntry, requires: undefined })?.requires).toEqual({
      nodeTypes: []
    })
  })

  it('非对象 / 数组 / null 一律 null', () => {
    for (const bad of [null, undefined, 'x', 42, []]) {
      expect(parseWorkflowMarketEntry(bad)).toBeNull()
    }
  })
})

describe('parseWorkflowMarketIndex：单条坏不拖垮整体，结构坏才整体失败', () => {
  it('正常索引解析并列 dropped: 0', () => {
    const result = parseWorkflowMarketIndex(indexWith([goodEntry]))
    if (!result.ok) throw new Error('应当成功')
    expect(result.dropped).toBe(0)
    expect(result.index.workflows).toHaveLength(1)
  })

  it('**单条非法只丢那一条并计数**，其余照常可用', () => {
    const result = parseWorkflowMarketIndex(
      indexWith([goodEntry, { id: 'bad id' }, null, { ...goodEntry, id: 'second-ok' }])
    )
    if (!result.ok) throw new Error('应当成功')
    expect(result.dropped).toBe(2)
    expect(result.index.workflows.map((w) => w.id)).toEqual(['short-drama-9grid', 'second-ok'])
  })

  it('**重复 id 视为非法**（会让安装目录与卡片互相覆盖）', () => {
    const result = parseWorkflowMarketIndex(indexWith([goodEntry, { ...goodEntry }]))
    if (!result.ok) throw new Error('应当成功')
    expect(result.dropped).toBe(1)
    expect(result.index.workflows).toHaveLength(1)
  })

  it('整体结构崩坏 → 失败并给原因键，不半渲染', () => {
    expect(parseWorkflowMarketIndex(null)).toEqual({ ok: false, reasonKey: 'notAnObject' })
    expect(parseWorkflowMarketIndex([])).toEqual({ ok: false, reasonKey: 'notAnObject' })
    expect(parseWorkflowMarketIndex({ schemaVersion: 1 })).toEqual({
      ok: false,
      reasonKey: 'noWorkflows'
    })
    expect(parseWorkflowMarketIndex({ schemaVersion: 1, workflows: 'nope' })).toEqual({
      ok: false,
      reasonKey: 'noWorkflows'
    })
  })

  it('schemaVersion 高于本应用能读的版本 → 明确要求更新应用', () => {
    const result = parseWorkflowMarketIndex({
      schemaVersion: WORKFLOW_MARKET_SCHEMA_VERSION + 1,
      workflows: []
    })
    expect(result).toEqual({ ok: false, reasonKey: 'schemaTooNew' })
  })

  it('空 workflows 是合法状态（市场还没内容）', () => {
    const result = parseWorkflowMarketIndex(indexWith([]))
    if (!result.ok) throw new Error('应当成功')
    expect(result.index.workflows).toEqual([])
    expect(result.dropped).toBe(0)
  })

  it('source 与 generatedAt 被带上（详情页要显示来源）', () => {
    const result = parseWorkflowMarketIndex({
      schemaVersion: 1,
      generatedAt: '2026-10-07T00:00:00Z',
      source: { repo: 'https://github.com/x/y', ref: 'main' },
      workflows: []
    })
    if (!result.ok) throw new Error('应当成功')
    expect(result.index.generatedAt).toBe('2026-10-07T00:00:00Z')
    expect(result.index.source).toEqual({ repo: 'https://github.com/x/y', ref: 'main' })
  })
})

describe('parseWorkflowBundle：plan 结构不合法即整体拒绝', () => {
  it('正常包解析', () => {
    const result = parseWorkflowBundle(goodBundle)
    if (!result.ok) throw new Error('应当成功')
    expect(result.bundle.id).toBe('short-drama-9grid')
    expect(result.bundle.plan.nodes).toHaveLength(2)
  })

  it('缺 plan / nodes 为空 → 拒绝', () => {
    expect(parseWorkflowBundle({ ...goodBundle, plan: undefined })).toEqual({
      ok: false,
      reasonKey: 'noPlan'
    })
    expect(parseWorkflowBundle({ ...goodBundle, plan: { nodes: [] } })).toEqual({
      ok: false,
      reasonKey: 'noNodes'
    })
    expect(parseWorkflowBundle({ ...goodBundle, plan: { nodes: 'x' } })).toEqual({
      ok: false,
      reasonKey: 'noNodes'
    })
  })

  it('节点 key 重复 → 拒绝（物化时 key 是连线与 params 的引用基准）', () => {
    const plan = {
      nodes: [
        { key: 'a', typeId: 'asset.text' },
        { key: 'a', typeId: 'asset.image' }
      ]
    }
    expect(parseWorkflowBundle({ ...goodBundle, plan })).toEqual({
      ok: false,
      reasonKey: 'duplicateNodeKey'
    })
  })

  it('节点缺 key 或 typeId → 拒绝', () => {
    expect(parseWorkflowBundle({ ...goodBundle, plan: { nodes: [{ key: 'a' }] } })).toEqual({
      ok: false,
      reasonKey: 'badNode'
    })
    expect(
      parseWorkflowBundle({ ...goodBundle, plan: { nodes: [{ typeId: 'asset.text' }] } })
    ).toEqual({ ok: false, reasonKey: 'badNode' })
  })

  it('**edges 悬空端点 → 拒绝**（否则物化出残图）', () => {
    const plan = { ...goodPlan, edges: [{ from: 'script', to: 'ghost' }] }
    expect(parseWorkflowBundle({ ...goodBundle, plan })).toEqual({
      ok: false,
      reasonKey: 'danglingEdge'
    })
    const plan2 = { ...goodPlan, edges: [{ from: 'ghost', to: 'grid' }] }
    expect(parseWorkflowBundle({ ...goodBundle, plan: plan2 })).toEqual({
      ok: false,
      reasonKey: 'danglingEdge'
    })
  })

  it('edges 缺省合法（单节点工作流）', () => {
    const plan = { nodes: [{ key: 'only', typeId: 'asset.text' }] }
    const result = parseWorkflowBundle({ ...goodBundle, plan })
    if (!result.ok) throw new Error('应当成功')
    expect(result.bundle.plan.edges).toEqual([])
  })

  it('edges 非数组 → 拒绝', () => {
    expect(parseWorkflowBundle({ ...goodBundle, plan: { ...goodPlan, edges: 'x' } })).toEqual({
      ok: false,
      reasonKey: 'badEdges'
    })
  })

  it('包里的 id 不合法 → 拒绝（安装目录名取自 id）', () => {
    expect(parseWorkflowBundle({ ...goodBundle, id: 'Bad Id' })).toEqual({
      ok: false,
      reasonKey: 'badId'
    })
  })
})

describe('nodeTypesOfPlan：与仓库脚本同一口径', () => {
  it('去重并排序', () => {
    expect(
      nodeTypesOfPlan({
        nodes: [
          { key: 'a', typeId: 'asset.image' },
          { key: 'b', typeId: 'asset.text' },
          { key: 'c', typeId: 'asset.image' }
        ],
        edges: []
      })
    ).toEqual(['asset.image', 'asset.text'])
  })

  it('忽略空白 typeId', () => {
    expect(nodeTypesOfPlan({ nodes: [{ key: 'a', typeId: '  ' }], edges: [] })).toEqual([])
  })
})

describe('compareSemver', () => {
  it('按主次修订号比较', () => {
    expect(compareSemver('1.0.0', '1.0.1')).toBeLessThan(0)
    expect(compareSemver('1.2.0', '1.1.9')).toBeGreaterThan(0)
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0)
  })

  it('不等长按缺位补 0', () => {
    expect(compareSemver('1.0', '1.0.0')).toBe(0)
    expect(compareSemver('1', '1.0.1')).toBeLessThan(0)
  })

  it('**预发布版小于同版本正式版**', () => {
    expect(compareSemver('1.0.0-beta.1', '1.0.0')).toBeLessThan(0)
    expect(compareSemver('1.0.0', '1.0.0-beta.1')).toBeGreaterThan(0)
  })

  it('两个预发布版之间可比较', () => {
    expect(compareSemver('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0)
    expect(compareSemver('1.0.0-beta', '1.0.0-alpha')).toBeGreaterThan(0)
  })

  it('**数字标识符优先级低于字母数字标识符**（朴素字符串比较会得出相反结论）', () => {
    // 按 semver：数字标识符比字母数字标识符低，即 1.0.0-1 < 1.0.0-alpha。
    // 字符串比较因 '1' < 'a' 会得出相反结果 —— 这是本实现刻意要纠正的反例。
    expect(compareSemver('1.0.0-1', '1.0.0-alpha')).toBeLessThan(0)
    expect(compareSemver('1.0.0-alpha', '1.0.0-1')).toBeGreaterThan(0)
  })

  it('数字标识符按**数值**比较（不是字典序）', () => {
    expect(compareSemver('1.0.0-2', '1.0.0-10')).toBeLessThan(0)
  })

  it('标识符少的预发布版优先级更低', () => {
    expect(compareSemver('1.0.0-alpha', '1.0.0-alpha.1')).toBeLessThan(0)
  })

  it('忽略 build 元数据', () => {
    expect(compareSemver('1.0.0+build.1', '1.0.0+build.2')).toBe(0)
    // 预发布版本带 build 也要正确
    expect(compareSemver('1.0.0-beta+exp.sha.5114f85', '1.0.0-beta')).toBe(0)
    expect(compareSemver('1.0.0-beta+exp', '1.0.0')).toBeLessThan(0)
  })

  it('脏值不抛错（按 0 处理）', () => {
    expect(() => compareSemver('garbage', '1.0.0')).not.toThrow()
  })
})

describe('兼容性判定：缺节点类型必须在使用前拦下', () => {
  const known = ['asset.text', 'asset.image', 'anim.2d']

  it('missingNodeTypes 列出本应用没有的类型（排序）', () => {
    expect(
      missingNodeTypes({ requires: { nodeTypes: ['zzz.new', 'asset.text', 'aaa.new'] } }, known)
    ).toEqual(['aaa.new', 'zzz.new'])
  })

  it('全部满足时为空', () => {
    expect(missingNodeTypes({ requires: { nodeTypes: ['asset.text'] } }, known)).toEqual([])
  })

  it('appMinVersion 高于当前版本 → appTooOld', () => {
    expect(
      workflowEntryBlockReason(
        { requires: { nodeTypes: [], appMinVersion: '9.0.0' } },
        { knownNodeTypes: known, appVersion: '7.1.3' }
      )
    ).toBe('appTooOld')
  })

  it('版本刚好等于要求 → 放行（不要求严格大于）', () => {
    expect(
      workflowEntryBlockReason(
        { requires: { nodeTypes: [], appMinVersion: '7.1.3' } },
        { knownNodeTypes: known, appVersion: '7.1.3' }
      )
    ).toBeNull()
  })

  it('**缺类型的优先级高于版本过低**（先告诉用户最具体的问题）', () => {
    expect(
      workflowEntryBlockReason(
        { requires: { nodeTypes: ['zzz.new'], appMinVersion: '9.0.0' } },
        { knownNodeTypes: known, appVersion: '7.1.3' }
      )
    ).toBe('missingNodeTypes')
  })

  it('无要求时放行', () => {
    expect(
      workflowEntryBlockReason(
        { requires: { nodeTypes: [] } },
        { knownNodeTypes: known, appVersion: '7.1.3' }
      )
    ).toBeNull()
  })
})

describe('分类与地址', () => {
  it('分类键只产出枚举内的键（未知落 utility）', () => {
    for (const category of WORKFLOW_MARKET_CATEGORIES) {
      expect(workflowCategoryKey(category)).toBe(`marketplace.workflows.category.${category}`)
    }
    expect(workflowCategoryKey('nonsense')).toBe('marketplace.workflows.category.utility')
  })

  it('地址按仓库目录结构拼装，尾部斜杠不产生双斜杠', () => {
    const urls = workflowMarketUrls('https://raw.example.com/repo/main/')
    expect(urls.index).toBe('https://raw.example.com/repo/main/index.json')
    expect(urls.bundle('a-b')).toBe('https://raw.example.com/repo/main/workflows/a-b/workflow.json')
    expect(urls.cover({ id: 'a-b', cover: 'cover.png' })).toBe(
      'https://raw.example.com/repo/main/workflows/a-b/cover.png'
    )
    expect(urls.cover({ id: 'a-b' })).toBeNull()
  })
})

describe('与真实节点注册表的一致性', () => {
  it('仓库种子内容声明的类型必须都是本应用已注册的（否则一上线就不可用）', () => {
    // 内置预设是首批种子内容，它们用到的类型必须全在注册表里
    const known = listNodeTypes().map((def) => def.typeId)
    expect(known.length).toBeGreaterThan(30)
    expect(missingNodeTypes({ requires: { nodeTypes: known } }, known)).toEqual([])
  })
})
