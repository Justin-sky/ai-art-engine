/**
 * 官方 Blender Lab「MCP Server」扩展适配层测试（src/shared/blenderOfficialTools.ts）。
 *
 * 覆盖的都是「猜错就会静默失效」的地方：
 * - execute 帧编码：官方 addon 以 `\0` 作帧边界，JSON 本体必须转义控制字符，
 *   否则代码里的换行 / NUL 会把帧撕裂
 * - 帧切分：`\0` 之前没收全就是没帧；多余字节必须留在 rest 里
 * - stdout 提取：官方应答把被执代码的 print 带在 `stdout` 字段
 * - 工具编 Python：每个工具都必须能编出符合扩展约定（给 result 赋 dict）的代码，
 *   参数注入必须经过与社区后端同一套白名单校验
 */
import { describe, expect, it } from 'vitest'
import { BLENDER_TOOLS, blenderToolSpec, buildBlenderCommand } from '../src/shared/blenderMcp'
import {
  buildOfficialProbeCode,
  buildOfficialToolCode,
  encodeOfficialExecute,
  officialExecuteStdout,
  takeNullFrame
} from '../src/shared/blenderOfficialTools'

const ctx = { screenshotFilepath: '/tmp/shot.png' }

describe('encodeOfficialExecute / takeNullFrame', () => {
  it('帧尾是 \\0，type=execute，strict_json 打开', () => {
    const frame = encodeOfficialExecute('result = {}')
    expect(frame.endsWith('\0')).toBe(true)
    const parsed = JSON.parse(frame.slice(0, -1)) as Record<string, unknown>
    expect(parsed.type).toBe('execute')
    expect(parsed.strict_json).toBe(true)
    expect(parsed.code).toBe('result = {}')
  })

  it('代码里的控制字符被 JSON 转义，不会出现裸 \\0 撕裂帧', () => {
    const frame = encodeOfficialExecute('print("a\\nb")\nresult = {}')
    expect(frame.slice(0, -1).includes('\0')).toBe(false)
    expect(frame.endsWith('\0')).toBe(true)
  })

  it('没有 \\0 时不算完整帧；切分后余量保留', () => {
    expect(takeNullFrame('{"status":"ok"}')).toBeNull()
    const taken = takeNullFrame('{"a":1}\0{"b":2}\0')
    expect(taken?.frame).toBe('{"a":1}')
    expect(taken?.rest).toBe('{"b":2}\0')
    const tail = takeNullFrame('{"b":2}\0')
    expect(tail?.frame).toBe('{"b":2}')
    expect(tail?.rest).toBe('')
  })

  it('takeJsonFrame 的括号配平法切不动官方帧（协议互不兼容是设计事实）', async () => {
    const { takeJsonFrame } = await import('../src/shared/blenderMcp')
    // 官方帧里 JSON 完整，但切完会留下 `\0` 余量，且不会误吞下一帧
    const frame = encodeOfficialExecute('result = {}')
    const taken = takeJsonFrame(frame)
    expect(taken?.frame).toBe('{"type":"execute","code":"result = {}","strict_json":true}')
    expect(taken?.rest).toBe('\0')
  })
})

describe('officialExecuteStdout', () => {
  it('ok 应答里提取 stdout', () => {
    expect(
      officialExecuteStdout('{"status":"ok","result":{"executed":true},"stdout":"hi\\n"}')
    ).toBe('hi\n')
  })

  it('error 应答 / 缺 stdout / 非法 JSON 返回 null', () => {
    expect(officialExecuteStdout('{"status":"error","message":"boom"}')).toBeNull()
    expect(officialExecuteStdout('{"status":"ok","result":{}}')).toBeNull()
    expect(officialExecuteStdout('not-json')).toBeNull()
  })
})

describe('buildOfficialToolCode', () => {
  it('工具表里每个工具都能编出官方后端代码（不支持的必须显式失败）', () => {
    expect(BLENDER_TOOLS.length).toBeGreaterThanOrEqual(9)
    for (const tool of BLENDER_TOOLS) {
      const args: Record<string, unknown> =
        tool.name === 'get_object_info'
          ? { object_name: 'Cube' }
          : tool.name === 'bpy_api_lookup'
            ? { query: 'bpy.ops.mesh.primitive_cube_add' }
            : tool.name === 'describe_node_type'
              ? { bl_idname: 'ShaderNodeTexImage' }
              : tool.name === 'execute_blender_code'
                ? { code: 'print("x")' }
                : tool.name === 'export_scene'
                  ? { filepath: '/tmp/out.glb' }
                  : {}
      const code = buildOfficialToolCode(tool, args, ctx)
      expect(code.length).toBeGreaterThan(50)
      expect(code).toContain('result')
    }
  })

  it('参数走社区后端同一套白名单：必填缺失同样抛错', () => {
    const spec = blenderToolSpec('get_object_info')
    if (!spec) throw new Error('spec missing')
    expect(() => buildOfficialToolCode(spec, {}, ctx)).toThrow()
    // 社区后端路径也抛（行为对齐）
    expect(() => buildBlenderCommand(spec, {}, ctx)).toThrow()
  })

  it('参数以 Python 字面量注入 _p，字符串转义保持合法', () => {
    const spec = blenderToolSpec('get_object_info')
    if (!spec) throw new Error('spec missing')
    const code = buildOfficialToolCode(spec, { object_name: 'Cu"be\n名字' }, ctx)
    expect(code).toContain('_p = ')
    expect(code).toContain('"Cu\\"be\\n名字"')
  })

  it('execute_code：用户代码原样内联，尾部补 result 兜底（扩展要求 result 为 dict）', () => {
    const spec = blenderToolSpec('execute_blender_code')
    if (!spec) throw new Error('spec missing')
    const code = buildOfficialToolCode(spec, { code: 'print("hello")' }, ctx)
    expect(code.startsWith('print("hello")')).toBe(true)
    expect(code).toContain('result = {"executed": True}')
  })

  it('截图工具把主进程给的落盘路径注入 _p', () => {
    const spec = blenderToolSpec('get_viewport_screenshot')
    if (!spec) throw new Error('spec missing')
    const code = buildOfficialToolCode(spec, { max_size: 640 }, ctx)
    expect(code).toContain(`"filepath": "${ctx.screenshotFilepath}"`)
    expect(code).toContain('"max_size": 640')
    expect(code).toContain('screenshot_area')
  })

  it('探活帧带回版本三元组（Blender / addon / 协议）', () => {
    const code = buildOfficialProbeCode()
    expect(code).toContain('blender_version')
    expect(code).toContain('addon_version')
    expect(code).toContain('protocol_version')
  })

  it('生成的 Python 不含会撕裂模板的序列（反引号 / ${）', () => {
    const spec = blenderToolSpec('execute_blender_code')
    if (!spec) throw new Error('spec missing')
    const code = buildOfficialToolCode(spec, { code: 'x = 1' }, ctx)
    expect(code).not.toContain('`')
    expect(code).not.toContain('${')
  })
})
