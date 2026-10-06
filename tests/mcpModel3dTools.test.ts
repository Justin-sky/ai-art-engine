import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 3D 加工接入 MCP 工具层（P2 缺口）。
 *
 * 缺口的性质：Agent 已经能**生成** 3D（`generate_model3d`），却完全**不能加工**它 ——
 * 不能蒙皮、不能拆件、不能重拓扑、不能转格式。等于「图 → 3D → 加工」这条链只有半截。
 *
 * 采用与 IPC 通道**同构**的三工具划分（`gen:model3d-rig` / `-segment` / `-post`），
 * 另加一个只读的动作库工具。主进程服务依赖 Electron 单例、无法在此实例化，
 * 所以这里做源码级接线断言（与本仓其它 MCP 测试同一手法）。
 */
const SRC = readFileSync(resolve('src/main/services/mcpServerService.ts'), 'utf8')

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

const RIG = toolBlock('rig_model3d')
const SEGMENT = toolBlock('segment_model3d')
const POST = toolBlock('post_process_model3d')
const ANIMS = toolBlock('list_model3d_animations')

describe('三个加工工具都走 facade 且遵守 Cache-only 约定', () => {
  const cases: Array<[string, string, string]> = [
    ['rig_model3d', RIG, 'rigModel3d'],
    ['segment_model3d', SEGMENT, 'segmentModel3d'],
    ['post_process_model3d', POST, 'postProcessModel3d']
  ]

  it.each(cases)('%s 调 facade.%s', (_name, block, method) => {
    expect(block).toContain(`modelProviderFacade.${method}(input)`)
  })

  it.each(cases)('%s 不暴露 outputDir / folderId 且 settle 置 undefined', (_name, block) => {
    expect(block).not.toMatch(/['"]?outputDir['"]?\s*:/)
    expect(block).not.toMatch(/['"]?folderId['"]?\s*:/)
    expect(block).toContain('...cacheOnlyGenExtraParams(args)')
    expect(block).toMatch(/,\s*\n\s*undefined,\s*\n/)
  })

  it.each(cases)(
    '%s 用 resolveModel3dSourceInput 解析源模型（assetId → 相对路径）',
    (_name, block) => {
      expect(block).toContain('resolveModel3dSourceInput(args)')
    }
  )

  it.each(cases)('%s 描述里说明工程内文件需要对象存储', (_name, block) => {
    expect(block).toMatch(/对象存储/)
  })

  it.each(cases)('%s 活动名已登记进 McpActivityTool', (_name, block) => {
    const ipc = readFileSync(resolve('src/shared/ipc.ts'), 'utf8')
    expect(ipc).toContain(`| '${_name}'`)
  })
})

describe('rig_model3d', () => {
  it('把 taskId 回给 agent（下游重定向要用）', () => {
    expect(RIG).toMatch(/taskId: result\.taskId/)
  })

  it('说明只有 Meshy / Tripo 提供该能力', () => {
    expect(RIG).toMatch(/只有 Meshy 与 Tripo/)
  })

  it('spec / outFormat 枚举与类型一致', () => {
    expect(RIG).toMatch(/enum: \['tripo', 'mixamo'\]/)
    expect(RIG).toMatch(/enum: \['glb', 'fbx'\]/)
  })
})

describe('segment_model3d', () => {
  it('两种模式与两套粒度枚举（不要混用）', () => {
    expect(SEGMENT).toMatch(/enum: \['mesh', 'smart'\]/)
    // 网格分割：simple / balanced / detailed（prettier 可能折成单行，别按多行断言）
    expect(SEGMENT).toMatch(/'simple',\s*'balanced',\s*'detailed'/)
    // 智能分割：coarse / medium / fine（与网格分割不是同一套）
    expect(SEGMENT).toMatch(/'coarse',\s*'medium',\s*'fine'/)
  })

  it('返回部件名清单与 taskId（部件补全要用）', () => {
    expect(SEGMENT).toMatch(/parts: result\.parts/)
    expect(SEGMENT).toMatch(/taskId: result\.taskId/)
  })
})

describe('post_process_model3d', () => {
  it('op 是必填且经过白名单校验（给得出可选值）', () => {
    expect(POST).toMatch(/required: \['op'\]/)
    expect(POST).toContain('POST_PROCESS_OPS.includes(')
    expect(POST).toMatch(/可选 \$\{POST_PROCESS_OPS\.join/)
  })

  it('白名单与 IPC 的 op 集合一致（6 个）', () => {
    const ops = ['rigCheck', 'retopology', 'meshComplete', 'retarget', 'convert', 'texture']
    for (const op of ops) expect(POST).toContain(`'${op}'`)
    // 常量定义在文件顶部，不在工具块内 —— 断言整份源码
    expect(SRC).toMatch(/const POST_PROCESS_OPS: readonly Model3dPostProcessOp\[\] = \[/)
    // 枚举里也必须有同一组（两处漂移会表现为"schema 允许但白名单拒绝"）
    expect(POST).toMatch(
      /enum: \['rigCheck', 'retopology', 'meshComplete', 'retarget', 'convert', 'texture'\]/
    )
  })

  it('rigCheck 无产物：不广播资产、不报 assetId', () => {
    // 结果联合类型里 rigCheck 分支没有 assetId；广播一个不存在的资产会让界面出错
    expect(POST).toContain('isProducingPostProcess(result)')
    expect(POST).toMatch(/if \(isProducingPostProcess\(result\)\) \{\s*\n\s*broadcastAsset/)
    expect(POST).not.toMatch(/result\.op !== 'rigCheck' && result\.assetId/)
  })

  it('类型守卫用"排除 rigCheck"而不是 Extract（Extract 会求成 never）', () => {
    expect(SRC).toMatch(/result is Exclude<Model3dPostProcessResult, \{ op: 'rigCheck' \}>/)
    expect(SRC).not.toMatch(/result is Extract<Model3dPostProcessResult, \{ assetId/)
  })

  it('convert 的目标格式枚举齐全（quad 会强制回 FBX）', () => {
    expect(POST).toMatch(/enum: \['GLTF', 'FBX', 'USDZ', 'OBJ', 'STL', '3MF'\]/)
  })

  it('说明里点明 task id 的归属约束（补全吃拆件、重定向吃绑骨）', () => {
    expect(POST).toMatch(/部件补全只吃拆件任务 id/)
    expect(POST).toMatch(/动画重定向只吃绑骨任务 id/)
  })

  it('说明里点明能力按供应商矩阵过滤', () => {
    expect(POST).toMatch(/能力按供应商矩阵过滤/)
  })

  it('日志类别用既有的 postProcessModel3d', () => {
    expect(POST).toMatch(/kind: 'postProcessModel3d'/)
  })
})

describe('list_model3d_animations', () => {
  it('只读工具：不产生费用、不写资产、无需生成闸门', () => {
    expect(ANIMS).toMatch(/只读操作，不产生费用、不写资产/)
    expect(ANIMS).not.toMatch(/runGenActivity/)
  })

  it('入参是 search 而不是 model（与 ListModel3dAnimationsInput 一致）', () => {
    expect(ANIMS).toMatch(/search: optionalString\(args, 'search'\)/)
    expect(ANIMS).not.toMatch(/model: optionalString/)
  })

  it('返回总数与清单，供 retarget 选动作', () => {
    expect(ANIMS).toMatch(/total: actions\.length/)
    expect(ANIMS).toMatch(/actions/)
  })
})

describe('新辅助函数', () => {
  it('resolveModel3dSourceInput 优先 modelUrl，其次 assetId → 相对路径', () => {
    expect(SRC).toMatch(
      /function resolveModel3dSourceInput[\s\S]{0,600}if \(modelUrl\) return \{ modelUrl \}[\s\S]{0,300}return \{ modelRelativePath: relativePath \}/
    )
  })

  it('readNumberList 接受数字字符串（部分客户端会把 JSON 数字序列化）', () => {
    expect(SRC).toMatch(
      /function readNumberList[\s\S]{0,400}typeof item === 'string' \? Number\(item\)/
    )
  })

  it('readEnumArg 非法值回落 undefined（交给上游默认，不报错）', () => {
    expect(SRC).toMatch(
      /function readEnumArg[\s\S]{0,400}allowed as readonly string\[\]\)\.includes\(trimmed\)/
    )
  })
})

describe('三个加工工具都进了生成闸门（外部付费）', () => {
  it('GATED_TOOLS 含 rig / segment / post_process', () => {
    const gated = SRC.slice(SRC.indexOf('const GATED_TOOLS'), SRC.indexOf('interface McpToolDef'))
    for (const name of ['rig_model3d', 'segment_model3d', 'post_process_model3d']) {
      expect(gated).toContain(`'${name}'`)
    }
    // 只读的动作库不该被闸门挡住
    expect(gated).not.toContain("'list_model3d_animations'")
  })
})
