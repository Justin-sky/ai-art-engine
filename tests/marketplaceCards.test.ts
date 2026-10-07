import { describe, expect, it } from 'vitest'
import {
  MCP_CARD_TITLE_KEYS,
  buildMarketplaceCards,
  countByCategory,
  createEmptyExternalMcpDraft,
  draftToExternalMcpServer,
  filterMarketplaceCards,
  marketplaceCardHeading,
  searchPlaceholderKey,
  skillSourceKey,
  type ExternalMcpDraft,
  type MarketplaceCard,
  type MarketplaceSources
} from '../src/renderer/src/features/marketplace/buildMarketplaceCards'
import { normalizeExternalMcpServer } from '../src/shared/externalMcp'
import type { WorkflowMarketEntryView } from '../src/shared/ipc'

/**
 * 插件市场的卡片归一与筛选（纯函数）。
 *
 * 三类内容来源完全不同（MCP 是运行中的本地端点、技能是磁盘文件、工作流来自远端仓库），
 * 视图层要一套网格 + 筛选就够 —— 前提是归一后的卡片模型稳定。
 * 组件依赖 Electron / three.js 无法挂载，所以判定逻辑刻意放在这里以便测试。
 */

function workflowEntry(over: Partial<WorkflowMarketEntryView> = {}): WorkflowMarketEntryView {
  return {
    id: 'short-drama',
    title: '短剧分镜',
    summary: '剧本 → 分镜 → 视频',
    category: 'film',
    tags: [],
    version: '1.0.0',
    author: { name: 'AIArtEngine' },
    license: 'CC-BY-4.0',
    nodeCount: 7,
    edgeCount: 6,
    missingNodeTypes: [],
    blockReason: null,
    installed: false,
    installedVersion: null,
    updatable: false,
    ...over
  }
}

function sources(over: Partial<MarketplaceSources> = {}): MarketplaceSources {
  return {
    mcp: {
      running: true,
      port: 43111,
      token: 'tok',
      configPath: '/tmp/mcp.json',
      endpoint: 'http://127.0.0.1:43111/mcp',
      blenderBridge: null
    },
    skills: {
      dirPath: '/home/u/.dsh/skills',
      builtinCount: 7,
      files: [
        {
          fileName: 'system-image.md',
          kind: 'builtin',
          title: '图片生成',
          description: 'Image — 图片生成'
        },
        { fileName: 'my-skill.md', kind: 'custom', title: 'my skill' }
      ]
    },
    workflows: [workflowEntry()],
    ...over
  }
}

describe('buildMarketplaceCards：三份来源归一成一种卡片', () => {
  it('顺序固定为 MCP → 技能 → 工作流', () => {
    const cards = buildMarketplaceCards(sources())
    expect(cards.map((card) => card.category)).toEqual(['mcp', 'skills', 'skills', 'workflows'])
    expect(cards[0]?.key).toBe('mcp:server')
    expect(cards[3]?.key).toBe('workflows:short-drama')
  })

  it('key 带类别前缀，跨类不会撞名', () => {
    const cards = buildMarketplaceCards(sources())
    const keys = cards.map((card) => card.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const card of cards) expect(card.key.startsWith(`${card.category}:`)).toBe(true)
  })

  it('MCP 主服务卡片带端口与运行状态，标题留给 i18n', () => {
    const [server] = buildMarketplaceCards(sources())
    expect(server?.title).toBeUndefined()
    expect(MCP_CARD_TITLE_KEYS[server!.key]).toBe('marketplace.card.mcpServer')
    expect(server?.meta).toBe('43111')
    expect(server?.identifier).toBe('aiartengine')
    expect(server?.sourceKey).toBe('marketplace.state.running')
    expect(server?.active).toBe(true)
  })

  it('主服务未运行时状态键切到 stopped 且 active=false', () => {
    const [server] = buildMarketplaceCards(sources({ mcp: { ...sources().mcp!, running: false } }))
    expect(server?.sourceKey).toBe('marketplace.state.stopped')
    expect(server?.active).toBe(false)
  })

  it('Blender 卡片只在桥存在时出现（与设置页原行为一致）', () => {
    expect(buildMarketplaceCards(sources()).some((c) => c.key === 'mcp:blender')).toBe(false)
    const withBridge = buildMarketplaceCards(
      sources({
        mcp: {
          ...sources().mcp!,
          blenderBridge: {
            enabled: true,
            mounted: true,
            endpoint: 'http://127.0.0.1:43111/mcp/blender',
            serverHost: '127.0.0.1',
            serverPort: 9876,
            safeMode: false,
            connected: true
          }
        }
      })
    )
    const blender = withBridge.find((c) => c.key === 'mcp:blender')
    expect(blender?.meta).toBe('127.0.0.1:9876')
    expect(blender?.sourceKey).toBe('marketplace.state.connected')
    expect(blender?.active).toBe(true)
    expect(MCP_CARD_TITLE_KEYS['mcp:blender']).toBe('marketplace.card.mcpBlender')
  })

  it('Blender 已启用但未挂载时 active=false（不能只看 enabled）', () => {
    const cards = buildMarketplaceCards(
      sources({
        mcp: {
          ...sources().mcp!,
          blenderBridge: {
            enabled: true,
            mounted: false,
            endpoint: '',
            serverHost: '127.0.0.1',
            serverPort: 9876,
            safeMode: false,
            connected: false
          }
        }
      })
    )
    const blender = cards.find((c) => c.key === 'mcp:blender')
    expect(blender?.active).toBe(false)
    expect(blender?.sourceKey).toBe('marketplace.state.disconnected')
  })

  it('技能标题用主进程给的可读标题，原文件名留在标识位', () => {
    const cards = buildMarketplaceCards(sources())
    // 内置项：标题是 GraphSkill 的中文名，而不是 system-image 这种 id 风格主干
    const builtin = cards.find((c) => c.key === 'skills:system-image.md')
    expect(builtin?.title).toBe('图片生成')
    expect(builtin?.identifier).toBe('system-image.md')
    expect(builtin?.subtitle).toBe('Image — 图片生成')

    const custom = cards.find((c) => c.key === 'skills:my-skill.md')
    expect(custom?.title).toBe('my skill')
    expect(custom?.identifier).toBe('my-skill.md')
    expect(custom?.sourceKey).toBe('marketplace.source.skill.custom')
    // 没给描述时不编造一行空的副标题
    expect(custom?.subtitle).toBeUndefined()
  })

  it('技能标题缺失时回落到文件名主干（不出现空标题）', () => {
    const cards = buildMarketplaceCards(
      sources({
        skills: {
          dirPath: '/x',
          builtinCount: 0,
          files: [{ fileName: 'no-title.md', kind: 'custom', title: '' }]
        }
      })
    )
    const card = cards.find((c) => c.category === 'skills')
    expect(card?.title).toBe('no-title')
  })

  it('工作流卡片带标题 / id / 版本 / 简介 / 作者 / 许可 / 规模', () => {
    const card = buildMarketplaceCards(sources()).find((c) => c.category === 'workflows')
    expect(card?.title).toBe('短剧分镜')
    expect(card?.identifier).toBe('short-drama')
    expect(card?.meta).toBe('v1.0.0')
    expect(card?.subtitle).toBe('剧本 → 分镜 → 视频')
    expect(card?.marketId).toBe('short-drama')
    expect(card?.author).toBe('AIArtEngine')
    expect(card?.license).toBe('CC-BY-4.0')
    expect(card?.nodeCount).toBe(7)
    expect(card?.edgeCount).toBe(6)
  })

  it('已安装且可用时状态点为「生效」；未安装为灰', () => {
    const installed = buildMarketplaceCards(
      sources({ workflows: [workflowEntry({ installed: true, installedVersion: '1.0.0' })] })
    ).find((c) => c.category === 'workflows')
    expect(installed?.installed).toBe(true)
    expect(installed?.active).toBe(true)

    const notInstalled = buildMarketplaceCards(sources()).find((c) => c.category === 'workflows')
    expect(notInstalled?.installed).toBe(false)
    expect(notInstalled?.active).toBe(false)
  })

  it('**缺依赖的工作流即便已安装也不算生效**（状态点不该是绿的）', () => {
    const card = buildMarketplaceCards(
      sources({
        workflows: [
          workflowEntry({
            installed: true,
            missingNodeTypes: ['future.node'],
            blockReason: 'missingNodeTypes'
          })
        ]
      })
    ).find((c) => c.category === 'workflows')
    expect(card?.active).toBe(false)
    expect(card?.missingNodeTypes).toEqual(['future.node'])
    expect(card?.blockReason).toBe('missingNodeTypes')
  })

  it('空数据源不产生卡片（不抛错）', () => {
    expect(buildMarketplaceCards({ mcp: null, skills: null, workflows: [] })).toEqual([])
  })

  it('技能目录存在但没有文件时不产生技能卡片', () => {
    const cards = buildMarketplaceCards(
      sources({ skills: { dirPath: '/x', builtinCount: 3, files: [] } })
    )
    expect(cards.some((c) => c.category === 'skills')).toBe(false)
  })
})

describe('filterMarketplaceCards：分类 + 关键词', () => {
  const cards = buildMarketplaceCards(sources())

  it('category=all 时返回全部', () => {
    expect(filterMarketplaceCards(cards, { category: 'all' })).toHaveLength(cards.length)
  })

  it('按类别过滤（严格相等，all 不是兜底）', () => {
    expect(filterMarketplaceCards(cards, { category: 'skills' }).map((c) => c.key)).toEqual([
      'skills:system-image.md',
      'skills:my-skill.md'
    ])
    expect(filterMarketplaceCards(cards, { category: 'workflows' })).toHaveLength(1)
  })

  it('关键词匹配标题 / 标识 / 副标题 / 作者 / 来源键，且不区分大小写', () => {
    // 『短剧分镜』命中标题；`short-drama` 命中标识；`剧本` 命中副标题
    expect(filterMarketplaceCards(cards, { category: 'all', query: '短剧' })).toHaveLength(1)
    expect(filterMarketplaceCards(cards, { category: 'all', query: 'SHORT-DRAMA' })).toHaveLength(1)
    expect(filterMarketplaceCards(cards, { category: 'all', query: '剧本' })).toHaveLength(1)
    // 作者（社区内容的发现路径之一）。
    // 注意：'aiartengine' 同时命中 MCP 主服务卡的 identifier，所以这里断言
    // **工作流卡在其中**，而不是断言总数 —— 后者会把「MCP 也叫这个名」变成假失败。
    const byAuthor = filterMarketplaceCards(cards, { category: 'all', query: 'aiartengine' })
    expect(byAuthor.some((card) => card.category === 'workflows')).toBe(true)
    expect(filterMarketplaceCards(cards, { category: 'all', query: 'my-skill' })).toHaveLength(1)
    // 命中来源键（sourceKey 里含 'skill'）
    expect(
      filterMarketplaceCards(cards, { category: 'all', query: 'source.skill.custom' })
    ).toHaveLength(1)
    // 命中副标题（工作流的简介里含「剧本」）
    expect(filterMarketplaceCards(cards, { category: 'all', query: '剧本' })).toHaveLength(1)
  })

  it('空查询 / 全空白查询返回该类别全部', () => {
    expect(filterMarketplaceCards(cards, { category: 'mcp', query: '' })).toHaveLength(1)
    expect(filterMarketplaceCards(cards, { category: 'mcp', query: '   ' })).toHaveLength(1)
  })

  it('无匹配返回空数组（视图层据此显示空态）', () => {
    expect(filterMarketplaceCards(cards, { category: 'all', query: 'zzz-nothing' })).toEqual([])
  })

  it('分类与关键词同时生效（不互相绕过）', () => {
    // 'acme' 只存在于扩展卡片：限定到技能类别后必须为空
    expect(filterMarketplaceCards(cards, { category: 'skills', query: 'acme' })).toEqual([])
  })
})

describe('countByCategory：页签角标', () => {
  it('all 等于总数，各类分别计数', () => {
    const counts = countByCategory(buildMarketplaceCards(sources()))
    expect(counts.all).toBe(4)
    expect(counts.mcp).toBe(1)
    expect(counts.skills).toBe(2)
    // 分类枚举已换成 workflows：旧的 plugins 计数不该再存在
    expect('plugins' in counts).toBe(false)
    expect(counts.workflows).toBe(1)
  })

  it('空输入时各项为 0（all 也是 0，不是 undefined）', () => {
    expect(countByCategory([])).toEqual({ all: 0, mcp: 0, skills: 0, workflows: 0 })
  })
})

describe('来源键助手：未知值不产生不存在的键', () => {
  it('skillSourceKey 把未知 kind 归到 custom', () => {
    expect(skillSourceKey('builtin')).toBe('marketplace.source.skill.builtin')
    expect(skillSourceKey('template')).toBe('marketplace.source.skill.template')
    expect(skillSourceKey('custom')).toBe('marketplace.source.skill.custom')
    expect(skillSourceKey('whatever')).toBe('marketplace.source.skill.custom')
  })
})

describe('第三方 MCP 服务卡', () => {
  const external = [
    {
      id: 'maps',
      name: '高德地图',
      transport: 'http' as const,
      enabled: true,
      url: 'https://api.example.com/mcp',
      headers: {},
      command: '',
      args: [],
      env: {},
      timeoutMs: 60000
    },
    {
      id: 'notes',
      name: 'Notes',
      transport: 'stdio' as const,
      enabled: true,
      url: '',
      headers: {},
      command: 'npx',
      args: ['-y', 'notes-mcp'],
      env: {},
      timeoutMs: 30000
    },
    {
      id: 'broken',
      name: 'Broken',
      transport: 'http' as const,
      enabled: true,
      url: '',
      headers: {},
      command: '',
      args: [],
      env: {},
      timeoutMs: 60000
    },
    {
      id: 'off',
      name: 'Off',
      transport: 'http' as const,
      enabled: false,
      url: 'https://off.example.com/mcp',
      headers: {},
      command: '',
      args: [],
      env: {},
      timeoutMs: 60000
    }
  ]

  it('每条一张卡，且排在内建 MCP 两条之后', () => {
    const cards = buildMarketplaceCards(sources({ external }))
    expect(cards.filter((c) => c.category === 'mcp').map((c) => c.key)).toEqual([
      'mcp:server',
      'mcp:ext:maps',
      'mcp:ext:notes',
      'mcp:ext:broken',
      'mcp:ext:off'
    ])
    expect(cards.find((c) => c.key === 'mcp:ext:maps')?.serverId).toBe('maps')
  })

  it('标题用用户起的名字；标识按接入方式显示地址或命令', () => {
    const cards = buildMarketplaceCards(sources({ external }))
    const maps = cards.find((c) => c.serverId === 'maps')
    expect(maps?.title).toBe('高德地图')
    expect(maps?.identifier).toBe('https://api.example.com/mcp')
    expect(maps?.subtitleKey).toBe('marketplace.card.externalHttpHint')

    const notes = cards.find((c) => c.serverId === 'notes')
    expect(notes?.identifier).toBe('npx')
    expect(notes?.subtitleKey).toBe('marketplace.card.externalStdioHint')
  })

  it('配置不可用时标出原因键，且状态点不是「生效中」', () => {
    const broken = buildMarketplaceCards(sources({ external })).find((c) => c.serverId === 'broken')
    expect(broken?.unusableKey).toBe('missingUrl')
    expect(broken?.active).toBe(false)
  })

  it('停用的服务状态键为 disabled 且 active=false', () => {
    const off = buildMarketplaceCards(sources({ external })).find((c) => c.serverId === 'off')
    expect(off?.sourceKey).toBe('marketplace.state.disabled')
    expect(off?.active).toBe(false)
  })

  it('启用的服务状态键为 enabled 且 active=true', () => {
    const maps = buildMarketplaceCards(sources({ external })).find((c) => c.serverId === 'maps')
    expect(maps?.sourceKey).toBe('marketplace.state.enabled')
    expect(maps?.active).toBe(true)
  })

  it('没有 external 字段时不产生外部卡（旧设置兼容）', () => {
    const cards = buildMarketplaceCards({ mcp: sources().mcp, skills: null, workflows: [] })
    expect(cards.some((c) => c.serverId)).toBe(false)
  })

  it('外部卡也参与分类计数与关键词搜索', () => {
    const cards = buildMarketplaceCards(sources({ external }))
    expect(countByCategory(cards).mcp).toBe(5) // 内建 1（无 Blender 桥）+ 外部 4
    expect(filterMarketplaceCards(cards, { category: 'mcp', query: 'notes' })).toHaveLength(1)
  })

  it('外部卡上模块自产的文案一律是 i18n 键（用户名字除外，那是数据）', () => {
    for (const card of buildMarketplaceCards(sources({ external }))) {
      if (!card.serverId) continue
      expect(card.subtitleKey).toMatch(/^marketplace\./)
      expect(card.sourceKey).toMatch(/^marketplace\./)
    }
  })
})

describe('draftToExternalMcpServer：添加对话框的业务规则', () => {
  const draft = (over: Partial<ExternalMcpDraft> = {}): ExternalMcpDraft => ({
    ...createEmptyExternalMcpDraft(),
    ...over
  })

  it('http：地址合法时产出配置，id 由名称推导', () => {
    const { server } = draftToExternalMcpServer(
      draft({ name: 'Maps', transport: 'http', url: ' https://api.example.com/mcp ' }),
      []
    )
    expect(server?.id).toBe('maps')
    expect(server?.name).toBe('Maps')
    expect(server?.url).toBe('https://api.example.com/mcp') // 两端空白已去
    expect(server?.transport).toBe('http')
    // http 形态不该带上 stdio 字段
    expect(server?.command).toBe('')
  })

  it('http：缺地址 / 地址非法各自给出原因键', () => {
    expect(draftToExternalMcpServer(draft({ transport: 'http', url: '  ' }), []).reason).toBe(
      'missingUrl'
    )
    expect(
      draftToExternalMcpServer(draft({ transport: 'http', url: 'not-a-url' }), []).reason
    ).toBe('invalidUrl')
    // file: 之类也要挡住（UI 先挡比运行时报错好）
    expect(
      draftToExternalMcpServer(draft({ transport: 'http', url: 'file:///etc/passwd' }), []).reason
    ).toBe('invalidUrl')
  })

  it('stdio：命令非空即可，stdio 字段填好、http 字段清空', () => {
    const { server } = draftToExternalMcpServer(
      draft({
        name: 'Notes',
        transport: 'stdio',
        command: ' npx ',
        argsText: ' -y\n\n notes-mcp \n',
        url: 'https://ignored.example.com'
      }),
      []
    )
    expect(server?.command).toBe('npx')
    expect(server?.args).toEqual(['-y', 'notes-mcp']) // 按行拆、去空行、去空白
    expect(server?.url).toBe('') // 换过形态后不残留地址
  })

  it('stdio：缺命令给出原因键', () => {
    expect(draftToExternalMcpServer(draft({ transport: 'stdio', command: '   ' }), []).reason).toBe(
      'missingCommand'
    )
  })

  it('id 与已有列表去重（重复 id 会让后加的那条永远收不到请求）', () => {
    const first = draftToExternalMcpServer(
      draft({ name: 'Maps', transport: 'http', url: 'https://a.example.com/mcp' }),
      []
    )
    const second = draftToExternalMcpServer(
      draft({ name: 'Maps', transport: 'http', url: 'https://b.example.com/mcp' }),
      [first.server!.id]
    )
    expect(first.server?.id).toBe('maps')
    expect(second.server?.id).toBe('maps-2')
    expect(second.server?.id).not.toBe(first.server?.id)
  })

  it('没有名称时用地址 / 命令推导 id，并把 id 当作显示名', () => {
    const http = draftToExternalMcpServer(
      draft({ transport: 'http', url: 'https://api.example.com/mcp' }),
      []
    )
    expect(http.server?.id).toBe('https-api-example-com-mcp')
    expect(http.server?.name).toBe('https-api-example-com-mcp')

    const stdio = draftToExternalMcpServer(
      draft({ name: '', transport: 'stdio', command: 'npx' }),
      []
    )
    expect(stdio.server?.id).toBe('npx')
  })

  it('中文名称取不到 ASCII 时 id 回落，但显示名保留原文', () => {
    const { server } = draftToExternalMcpServer(
      draft({ name: '高德地图', transport: 'http', url: 'https://x.example.com/mcp' }),
      []
    )
    expect(server?.id).toBe('mcp')
    expect(server?.name).toBe('高德地图')
  })

  it('失败时不返回半成品（只有 reason，没有 server）', () => {
    const failed = draftToExternalMcpServer(draft({ transport: 'http', url: '' }), [])
    expect(failed.server).toBeUndefined()
    expect(failed.reason).toBe('missingUrl')
  })

  it('产出的配置能被归一化接受（与持久化口径一致）', () => {
    const { server } = draftToExternalMcpServer(
      draft({ name: 'Maps', transport: 'http', url: 'https://api.example.com/mcp' }),
      []
    )
    // 能原样通过 normalizeExternalMcpServer 才说明这份配置真的存得进去
    expect(normalizeExternalMcpServer(server)).toEqual(server)
  })
})

describe('searchPlaceholderKey：搜索框占位跟着页签走', () => {
  it('每个页签都有自己的键', () => {
    expect(searchPlaceholderKey('all')).toBe('marketplace.searchPlaceholder.all')
    expect(searchPlaceholderKey('mcp')).toBe('marketplace.searchPlaceholder.mcp')
    expect(searchPlaceholderKey('skills')).toBe('marketplace.searchPlaceholder.skills')
    expect(searchPlaceholderKey('workflows')).toBe('marketplace.searchPlaceholder.workflows')
  })

  it('四个键互不相同（不能把某两个页签指到同一句）', () => {
    const keys = (['all', 'mcp', 'skills', 'workflows'] as const).map(searchPlaceholderKey)
    expect(new Set(keys).size).toBe(4)
  })

  it('键都落在 marketplace.searchPlaceholder.* 下（与 locale 层级一致）', () => {
    for (const category of ['all', 'mcp', 'skills', 'workflows'] as const) {
      expect(searchPlaceholderKey(category)).toMatch(/^marketplace\.searchPlaceholder\./)
    }
  })

  it('分类枚举里不再有 plugins', () => {
    const keys = (['all', 'mcp', 'skills', 'workflows'] as const).map(searchPlaceholderKey)
    expect(keys.some((key) => key.includes('plugins'))).toBe(false)
  })
})

describe('marketplaceCardHeading：标题栏文案', () => {
  const translate = (key: string): string => `T:${key}`

  it('MCP 两条卡走 i18n 固定标题', () => {
    expect(
      marketplaceCardHeading({ key: 'mcp:server', identifier: 'aiartengine' }, translate)
    ).toBe('T:marketplace.card.mcpServer')
    expect(marketplaceCardHeading({ key: 'mcp:blender', identifier: 'blender' }, translate)).toBe(
      'T:marketplace.card.mcpBlender'
    )
  })

  it('数据自带标题优先于 i18n（技能 / 工作流）', () => {
    expect(
      marketplaceCardHeading({ key: 'skills:my.md', identifier: 'my.md', title: 'my' }, translate)
    ).toBe('my')
    expect(
      marketplaceCardHeading(
        { key: 'workflows:short-drama', identifier: 'short-drama', title: '短剧分镜' },
        translate
      )
    ).toBe('短剧分镜')
  })

  it('既不认识 key 又没有标题时回落到标识（不出现空标题）', () => {
    expect(marketplaceCardHeading({ key: 'skills:x.md', identifier: 'x.md' }, translate)).toBe(
      'x.md'
    )
  })

  it('与实际卡片产物一致：每张卡都有非空标题', () => {
    for (const card of buildMarketplaceCards(sources())) {
      const heading = marketplaceCardHeading(card, translate)
      expect(heading.length).toBeGreaterThan(0)
      expect(heading).not.toContain('undefined')
    }
  })
})

describe('卡片模型不含展示文案（文案只在 locale 文件）', () => {
  it('模块自己产出的键一律是 i18n 键，且不含硬编码文案', () => {
    const cards: MarketplaceCard[] = buildMarketplaceCards(sources())
    for (const card of cards) {
      // 模块产出的字段：必须是键，不能是成品文案
      for (const key of [card.sourceKey, card.subtitleKey]) {
        if (typeof key !== 'string') continue
        expect(key, `${card.key} 的来源/副标题不是 i18n 键`).toMatch(/^marketplace\./)
      }
      // `identifier` 是数据（文件名 / 地址 / 命令），不该被本模块塞进任何文案
      expect(card.identifier).not.toMatch(/[\u4e00-\u9fff]/)
    }
  })

  it('title / subtitle 是**数据**，允许含中文（技能中文名就是数据，不是界面文案）', () => {
    // 这条是刻意反向断言：早先这里断言「卡片所有文本字段都不含中文」，
    // 那条断言在「技能标题改用 GraphSkill 中文名」之后就变成了错的约束 ——
    // 卡片标题来自用户/内置数据，界面文案才必须走 locale。
    const cards = buildMarketplaceCards(sources())
    const builtin = cards.find((c) => c.key === 'skills:system-image.md')
    expect(builtin?.title).toBe('图片生成')
  })
})
