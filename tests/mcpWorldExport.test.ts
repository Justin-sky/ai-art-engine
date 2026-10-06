import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `export_spatial_world` —— 把 `generate_world` 产出的**世界**导出成可编排产物。
 *
 * 为什么需要它：世界端口是**严格同类型**的（`spatialWorld` 不隐式兼容 `model`），
 * 所以「世界 → 3D 加工 / 导演台」必须经过导出。此前导出只有图节点 + IPC，
 * Agent 拿到世界也接不下去 —— 这是"世界"链路的断点。
 *
 * 主进程服务依赖 Electron 单例、无法在此环境实例化，所以这里做**源码级接线断言**
 * （与 tests/mcpVoiceTools.test.ts、mcpGenToolSchema.test.ts 同一手法）。
 */
const SRC = readFileSync(resolve('src/main/services/mcpServerService.ts'), 'utf8')
const FACADE = readFileSync(resolve('src/main/services/modelProviders/facade.ts'), 'utf8')

/**
 * 取某个工具的完整定义块。
 *
 * 结束边界：优先取「下一个 `name: '<工具名>',`」（下一个工具的开头），
 * 当前是数组最后一个工具时退回「数组结束 `\n]\n`」。
 *
 * 不要用「下一个 `\n  {\n`」—— 对数组最后一个工具它会一路吃到文件末，
 * 把后面函数里出现的 `folderId:` 也算进块里，造成假失败（真踩过）。
 */
function toolBlock(toolName: string): string {
  const marker = `name: '${toolName}',`
  const start = SRC.indexOf(marker)
  expect(start, `找不到工具 ${toolName} 的定义`).toBeGreaterThanOrEqual(0)

  const nextTool = SRC.indexOf("name: '", start + marker.length)
  const arrayEnd = SRC.indexOf('\n]\n', start + marker.length)
  const candidates = [nextTool, arrayEnd].filter((n) => n > 0)
  const end = candidates.length ? Math.min(...candidates) : SRC.length
  return SRC.slice(start, end)
}

const BLOCK = toolBlock('export_spatial_world')

describe('export_spatial_world 的参数', () => {
  it('暴露世界标识与导出规格', () => {
    for (const key of [
      'spatialWorldId',
      'spatialWorldAssetId',
      'sourceRelativePath',
      'assetType',
      'meshVariant',
      'resolution'
    ]) {
      expect(BLOCK, `缺少 ${key}`).toContain(key)
    }
  })

  it('assetType 只允许 mesh / splats，且默认 mesh', () => {
    expect(BLOCK).toMatch(/enum: \['mesh', 'splats'\]/)
    expect(BLOCK).toMatch(/args\.assetType === 'splats' \? 'splats' : 'mesh'/)
  })

  it('resolution 档位与执行器同一组取值', () => {
    expect(BLOCK).toMatch(/enum: \['full_res', '500k', '150k', '100k'\]/)
    // 非法值回落 full_res（与 shared/graph/execute/spatialWorldExport.ts 同口径）
    expect(SRC).toMatch(
      /function readExportResolution[\s\S]{0,220}raw === '500k' \|\| raw === '150k' \|\| raw === '100k' \? raw : 'full_res'/
    )
  })

  it('说明里写清了计费与耗时（避免 Agent 以为很快）', () => {
    expect(BLOCK).toMatch(/单独计费/)
    expect(BLOCK).toMatch(/最长约 1 小时/)
    expect(BLOCK).toMatch(/限速 4 次\/小时/)
  })

  it('说明里点明「只想看就不必导出」（免费的 .spz 已能浏览）', () => {
    expect(BLOCK).toMatch(/\.spz/)
    expect(BLOCK).toMatch(/不必导出/)
  })
})

describe('export_spatial_world 的世界 id 解析', () => {
  it('显式 spatialWorldId 优先，其次按世界资产反查', () => {
    expect(BLOCK).toMatch(/explicitWorldId \?\?/)
    expect(BLOCK).toContain('recoverSpatialWorldId({ assetId })')
  })

  it('两条都拿不到时明确报错，不猜', () => {
    expect(BLOCK).toContain('SHARED_ERRORS.worldExportNoWorldId')
    // 报错文案要给出两条可行路径（图节点接线 / MCP 传参）
    const catalog = readFileSync(resolve('src/shared/errors/catalog.ts'), 'utf8')
    expect(catalog).toContain('worldExportNoWorldId')
    expect(catalog).toMatch(/空间世界生成/)
    expect(catalog).toMatch(/spatialWorldAssetId/)
  })

  it('用 findAssetOrThrow 取世界资产（顺带校验 id 有效）', () => {
    expect(BLOCK).toContain('findAssetOrThrow(assetId)')
    // splats 的源路径可以从世界资产取
    expect(BLOCK).toMatch(/asset\?\.relativePath/)
  })
})

describe('export_spatial_world 的导出语义', () => {
  it('走 facade.exportWorld（mesh 的异步轮询由 facade 内部 await 到完成）', () => {
    expect(BLOCK).toContain('modelProviderFacade.exportWorld(input)')
  })

  it('format 跟着 assetType：mesh→glb / splats→ply', () => {
    expect(BLOCK).toMatch(/format: assetType === 'splats' \? 'ply' : 'glb'/)
  })

  it('meshVariant 只在 mesh 时下发（splats 不吃它）', () => {
    expect(BLOCK).toMatch(/assetType === 'mesh'[\s\S]{0,120}meshVariant/)
    expect(BLOCK).toMatch(
      /assetType === 'splats' \? \{ resolution: readExportResolution\(args\) \} : \{\}/
    )
  })

  it('splats 不登记资产：只有 mesh 才广播资产卡', () => {
    // PLY 没有对应资产类型，广播一个不存在的 assetId 会让界面出错
    expect(BLOCK).toMatch(/if \(result\.assetId\) broadcastAsset\(result\.assetId\)/)
    expect(BLOCK).toMatch(/PLY 泼溅落在世界产物同目录同名/)
  })

  it('遵守生成工具的 Cache-only 约定（不暴露 outputDir / folderId、settle 置 undefined）', () => {
    expect(BLOCK).not.toMatch(/['"]?outputDir['"]?\s*:/)
    expect(BLOCK).not.toMatch(/['"]?folderId['"]?\s*:/)
    expect(BLOCK).toContain('...cacheOnlyGenExtraParams(args)')
    expect(BLOCK).toMatch(/,\s*\n\s*undefined,\s*\n/)
  })

  it('活动名登记在 McpActivityTool（界面卡片靠它）', () => {
    expect(BLOCK).toContain("'export_spatial_world'")
    const ipc = readFileSync(resolve('src/shared/ipc.ts'), 'utf8')
    expect(ipc).toContain("| 'export_spatial_world'")
  })

  it('日志类别用既有的 exportWorld（runLog 里已有该 kind）', () => {
    expect(BLOCK).toMatch(/kind: 'exportWorld'/)
    const runLog = readFileSync(resolve('src/shared/graph/execute/runLog.ts'), 'utf8')
    expect(runLog).toContain("'exportWorld'")
  })
})

describe('源路径缺失时的报错文案不再只提图节点', () => {
  it('facade 的错误同时给出 MCP 的两条参数路径', () => {
    expect(FACADE).toMatch(/spatialWorldAssetId \/ sourceRelativePath/)
  })
})

describe('generate_world 必须把世界 id 回给 Agent（否则下游拿不到）', () => {
  it('返回值展开整个 result，包含 spatialWorldId', () => {
    const world = toolBlock('generate_world')
    expect(world).toMatch(/return \{\s*\n\s*\.\.\.result,/)
  })
})

/**
 * 世界生成随包返回的高斯泼溅 / 360 全景要**折叠进同一张对话卡**。
 *
 * 两条链入口不同，都必须覆盖：
 * - 图运行 / 一键工作流 → 扫盘链（`groupRoundOutputs` 的代表挑选）
 * - 对话里直接生成 → MCP 工具链（`relatedPaths` + `splitPrimaryAndRelated`）
 *
 * 这条守的是**工具链**：extras 必须从工具返回值一路透到对话卡。
 */
describe('世界附加产物：MCP 工具链的接线', () => {
  const world = toolBlock('generate_world')
  const chatPanel = readFileSync(resolve('src/renderer/src/components/ChatPanel.vue'), 'utf8')

  it('generate_world 用 splitPrimaryAndRelated 拆「代表 + 附件」', () => {
    expect(world).toContain('splitPrimaryAndRelated(')
    expect(world).toContain('relatedPaths: split.related')
  })

  it('附件取自 result.extras 的 relativePath', () => {
    expect(world).toMatch(/r\.extras \?\? \[\]\)\.map\(\(item\) => item\.relativePath\)/)
  })

  it('McpActivity 与活动服务都支持 relatedPaths', () => {
    const ipc = readFileSync(resolve('src/shared/ipc.ts'), 'utf8')
    const service = readFileSync(resolve('src/main/services/mcpActivityService.ts'), 'utf8')
    expect(ipc).toMatch(/relatedPaths\?: string\[\]/)
    expect(service).toContain('relatedPaths')
    expect(service).toMatch(/relatedPaths: relatedPaths\?\.length/)
  })

  it('runGenActivity 的 describe 允许返回 relatedPaths（否则类型不过）', () => {
    expect(SRC).toMatch(/describe: \(result: T\) => \{[\s\S]{0,420}relatedPaths\?: string\[\]/)
  })

  it('ChatPanel 把附件折叠进第一张卡，而不是逐条出卡', () => {
    expect(chatPanel).toContain('activity.relatedPaths')
    expect(chatPanel).toMatch(/index === 0 \? attachments : \[\]/)
  })
})
