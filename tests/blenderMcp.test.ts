/**
 * Blender 工具面纯逻辑测试（src/shared/blenderMcp.ts）。
 *
 * 这里覆盖的都是「猜错就会静默失效」的地方：
 * - 工具表 → addon 命令的映射（addon 用 `handler(**params)` 展开，多一个键就是 TypeError）
 * - 裸 JSON 帧切分（addon 没有分隔符，切错就是一帧粘两帧 / 永远等不到完整帧）
 * - 应答归一（execute_code 失败是嵌套 JSON，错误藏在 result.error 里）
 * - 代码护栏（放行常用 bpy 写法，拦住结构性逃脱；字符串 / 注释里的词不能误伤）
 */
import { describe, expect, it } from 'vitest'
import {
  BLENDER_ADDON_DEFAULT_HOST,
  BLENDER_ADDON_DEFAULT_PORT,
  BLENDER_MCP_PATH,
  BLENDER_TOOLS,
  blenderToolAccessOf,
  blenderToolDescriptors,
  blenderToolSpec,
  buildBlenderCommand,
  guardBlenderCode,
  maskPythonLiterals,
  parseBlenderReply,
  takeJsonFrame
} from '../src/shared/blenderMcp'

const ctx = { screenshotFilepath: '/tmp/shot.png' }

function commandOf(name: string, args: Record<string, unknown> = {}) {
  const spec = blenderToolSpec(name)
  if (!spec) throw new Error(`工具不存在: ${name}`)
  return buildBlenderCommand(spec, args, ctx)
}

describe('工具表', () => {
  it('默认指向 addon.py 的监听地址，且挂在 /mcp/blender 路径上', () => {
    expect(BLENDER_ADDON_DEFAULT_HOST).toBe('localhost')
    expect(BLENDER_ADDON_DEFAULT_PORT).toBe(9876)
    expect(BLENDER_MCP_PATH).toBe('/mcp/blender')
  })

  it('工具名唯一、command 非空、schema 是 object', () => {
    const names = BLENDER_TOOLS.map((tool) => tool.name)
    expect(new Set(names).size).toBe(names.length)
    for (const tool of BLENDER_TOOLS) {
      expect(tool.command).toBeTruthy()
      expect(tool.inputSchema.type).toBe('object')
      expect(tool.description.length).toBeGreaterThan(10)
    }
  })

  it('描述符只暴露协议需要的四个字段', () => {
    const descriptors = blenderToolDescriptors()
    expect(descriptors.length).toBe(BLENDER_TOOLS.length)
    for (const descriptor of descriptors) {
      expect(Object.keys(descriptor).sort()).toEqual([
        'description',
        'inputSchema',
        'name',
        'title'
      ])
    }
  })

  it('未登记的工具按 write 兜底，execute_blender_code 是 write、读类工具是 read', () => {
    expect(blenderToolAccessOf('get_scene_info')).toBe('read')
    expect(blenderToolAccessOf('get_viewport_screenshot')).toBe('read')
    expect(blenderToolAccessOf('execute_blender_code')).toBe('write')
    expect(blenderToolAccessOf('export_scene')).toBe('write')
    expect(blenderToolAccessOf('不存在的工具')).toBe('write')
    expect(blenderToolSpec('不存在的工具')).toBeUndefined()
  })
})

describe('MCP 入参 → addon 命令', () => {
  it('无参命令不带任何键（addon 用 **params 展开，多余键会 TypeError）', () => {
    expect(commandOf('get_scene_info')).toEqual({ type: 'get_scene_info', params: {} })
    expect(commandOf('get_world_state_snapshot')).toEqual({
      type: 'get_world_state_snapshot',
      params: {}
    })
    expect(commandOf('get_addon_status')).toEqual({ type: 'get_addon_info', params: {} })
  })

  it('get_object_info 把 object_name 映射成 addon 的 name 关键字', () => {
    expect(commandOf('get_object_info', { object_name: 'Cube' })).toEqual({
      type: 'get_object_info',
      params: { name: 'Cube' }
    })
  })

  it('execute_blender_code 映射到 execute_code 并原样带 code', () => {
    const code = 'print(bpy.context.scene.name)'
    expect(commandOf('execute_blender_code', { code })).toEqual({
      type: 'execute_code',
      params: { code }
    })
  })

  it('截图把主进程给定的落盘路径注入 filepath（addon 只会往这个路径写）', () => {
    expect(commandOf('get_viewport_screenshot', { max_size: 1280 })).toEqual({
      type: 'get_viewport_screenshot',
      params: { max_size: 1280, filepath: '/tmp/shot.png', format: 'png' }
    })
    // 不传 max_size 时不能塞 undefined 键
    expect(commandOf('get_viewport_screenshot').params).toEqual({
      filepath: '/tmp/shot.png',
      format: 'png'
    })
  })

  it('export_scene 只搬运传入的可选字段，不整包透传', () => {
    expect(
      commandOf('export_scene', {
        filepath: '/tmp/out.glb',
        selection_only: true,
        无关的键: 'drop-me'
      })
    ).toEqual({
      type: 'export_scene',
      params: { filepath: '/tmp/out.glb', selection_only: true }
    })
    expect(
      commandOf('export_scene', { filepath: '/tmp/out.glb', object_names: ['Cube', ''] })
    ).toEqual({
      type: 'export_scene',
      params: { filepath: '/tmp/out.glb', object_names: ['Cube'] }
    })
  })

  it('必填缺失 / 类型不对直接抛错（错误信息写给模型看）', () => {
    expect(() => commandOf('get_object_info', {})).toThrow(/object_name/)
    expect(() => commandOf('execute_blender_code', { code: '   ' })).toThrow(/code/)
    expect(() => commandOf('export_scene', { filepath: 42 })).toThrow(/filepath/)
    expect(() => commandOf('bpy_api_lookup', {})).toThrow(/query/)
    expect(() => commandOf('describe_node_type', { bl_idname: '' })).toThrow(/bl_idname/)
  })
})

describe('takeJsonFrame —— 无分隔符协议的切帧', () => {
  it('完整帧一次切完，rest 为空', () => {
    const buffer = '{"status":"success","result":{"ok":1}}'
    expect(takeJsonFrame(buffer)).toEqual({ frame: buffer, rest: '' })
  })

  it('半截帧返回 null（继续等更多字节）', () => {
    expect(takeJsonFrame('{"status":"suc')).toBeNull()
    expect(takeJsonFrame('{"status":"success","result":{"ok":1}')).toBeNull()
  })

  it('两条应答粘在一个 chunk 里时，第一条被切出、第二条留在 rest', () => {
    const first = '{"status":"success","result":"a"}'
    const second = '{"status":"success","result":"b"}'
    expect(takeJsonFrame(first + second)).toEqual({ frame: first, rest: second })
  })

  it('字符串里的括号不算帧边界', () => {
    const buffer = '{"status":"success","result":{"code":"print(\'}\')"}}'
    expect(takeJsonFrame(buffer)).toEqual({ frame: buffer, rest: '' })
  })

  it('转义引号不会提前结束字符串状态', () => {
    const buffer = '{"status":"success","result":{"code":"print(\\"}\\")\\n"}}'
    expect(takeJsonFrame(buffer)).toEqual({ frame: buffer, rest: '' })
  })

  it('括号配平但不是合法 JSON 时不交出去（宁可继续等 / 走超时）', () => {
    expect(takeJsonFrame('{not json}')).toBeNull()
  })

  it('流首不是 { 或 [ 时不切帧', () => {
    expect(takeJsonFrame('garbage')).toBeNull()
  })

  it('前置空白被跳过', () => {
    const buffer = '  \n {"status":"success","result":1}'
    const taken = takeJsonFrame(buffer)
    expect(taken?.frame).toBe('{"status":"success","result":1}')
    expect(taken?.rest).toBe('')
  })

  it('中文内容（多字节）不影响配平', () => {
    const buffer = JSON.stringify({ status: 'success', result: { message: '已创建立方体' } })
    expect(takeJsonFrame(buffer)?.frame).toBe(buffer)
  })
})

describe('parseBlenderReply —— 四种应答形态', () => {
  it('status=success 时 payload 就是 result', () => {
    const reply = parseBlenderReply('{"status":"success","result":{"name":"Cube"}}')
    expect(reply).toEqual({ ok: true, payload: { name: 'Cube' } })
  })

  it('handler 自己返回 {error} 时算失败（外层仍是 success）', () => {
    const reply = parseBlenderReply('{"status":"success","result":{"error":"对象不存在"}}')
    expect(reply.ok).toBe(false)
    expect(reply.error).toBe('对象不存在')
  })

  it('status=error 时取 message', () => {
    const reply = parseBlenderReply('{"status":"error","message":"Unknown command type: x"}')
    expect(reply.ok).toBe(false)
    expect(reply.error).toBe('Unknown command type: x')
  })

  it('execute_code 的嵌套 JSON 被拆开，traceback 保留', () => {
    const nested = JSON.stringify({
      exception_type: 'AttributeError',
      message: "'NoneType' object has no attribute 'x'",
      traceback: 'Traceback (most recent call last):\n  File "<string>", line 2, in <module>'
    })
    const reply = parseBlenderReply(JSON.stringify({ status: 'error', message: nested }))
    expect(reply.ok).toBe(false)
    expect(reply.error).toContain('AttributeError')
    expect(reply.error).toContain('line 2')
  })

  it('空响应 / 非 JSON 都算失败并带上原文片段', () => {
    expect(parseBlenderReply('   ').ok).toBe(false)
    const reply = parseBlenderReply('<html>gateway</html>')
    expect(reply.ok).toBe(false)
    expect(reply.error).toContain('<html>')
  })

  it('没有 status 字段时整包当 payload（容忍版本差异）', () => {
    expect(parseBlenderReply('{"foo":1}')).toEqual({ ok: true, payload: { foo: 1 } })
  })

  it('顶层是标量时也算成功', () => {
    expect(parseBlenderReply('42')).toEqual({ ok: true, payload: 42 })
  })
})

describe('maskPythonLiterals', () => {
  it('抹掉注释与普通字符串内容，保留引号', () => {
    const masked = maskPythonLiterals('x = "bpy.ops.script"  # bpy.utils.register_class')
    expect(masked).not.toContain('bpy.ops.script')
    expect(masked).not.toContain('register_class')
    expect(masked).toContain('x =')
  })

  it('f-string 原样保留（{expr} 是真实代码）', () => {
    const masked = maskPythonLiterals('print(f"{eval(\'1\')}")')
    expect(masked).toContain('eval(')
  })

  it('三引号块整体抹掉，避免其中的行首 class 误判', () => {
    const masked = maskPythonLiterals('"""\nclass Foo\n"""\nprint(1)')
    expect(masked).not.toContain('class Foo')
    expect(masked).toContain('print(1)')
  })
})

describe('guardBlenderCode —— safe mode 护栏', () => {
  it('放行常用建模 / 材质 / 渲染 / 保存写法', () => {
    const scripts = [
      'import bpy\nimport mathutils\nbpy.ops.mesh.primitive_cube_add(size=2)\n',
      'import bmesh\nme = bpy.data.meshes.new("m")\n',
      'obj = bpy.data.objects["Cube"]\nobj.location = (0, 0, 1)\nobj.rotation_euler = (0, 0, 1.5)\n',
      'mat = bpy.data.materials.new("M")\nmat.use_nodes = True\nn = mat.node_tree.nodes.new("ShaderNodeTexImage")\n',
      'bpy.ops.render.render(write_still=True)\n',
      'bpy.ops.wm.save_as_mainfile(filepath="/tmp/a.blend")\n',
      'bpy.ops.export_scene.gltf(filepath="/tmp/a.glb")\n',
      'bpy.ops.object.select_all(action="SELECT")\n',
      'if obj:\n    print(f"{obj.name} ok")\n',
      'from mathutils import Vector\nv = Vector((1, 2, 3))\n',
      'print("bpy.ops.script 只是字符串")\n# bpy.utils.register_class 只是注释\n',
      'setattr(obj, "hide_viewport", True)\n'
    ]
    for (const script of scripts) {
      const verdict = guardBlenderCode(script)
      expect(verdict.reason, `被误拦: ${script}`).toBe('')
      expect(verdict.ok).toBe(true)
    }
  })

  it('拦住解释器逃脱与代码执行入口', () => {
    for (const script of [
      'eval("1+1")',
      'exec("import os")',
      'compile("x", "<s>", "exec")',
      '__import__("os")',
      'open("/etc/passwd")',
      'g = globals()',
      'print((1).__class__)',
      'obj.__dict__'
    ]) {
      expect(guardBlenderCode(script).ok, `漏拦: ${script}`).toBe(false)
    }
  })

  it('拦住危险 import，包括别名、通配与 from bpy', () => {
    expect(guardBlenderCode('import os').ok).toBe(false)
    expect(guardBlenderCode('import subprocess').ok).toBe(false)
    expect(guardBlenderCode('import socket').ok).toBe(false)
    expect(guardBlenderCode('import numpy as np').reason).toContain('别名')
    expect(guardBlenderCode('from os import system').ok).toBe(false)
    expect(guardBlenderCode('from bpy import ops').ok).toBe(false)
    expect(guardBlenderCode('from math import *').ok).toBe(false)
    expect(guardBlenderCode('import bpy.utils.previews').ok).toBe(false)
  })

  it('拦住持久代码与执行路径（handlers / timers / 类注册 / 文本数据块）', () => {
    expect(guardBlenderCode('bpy.app.handlers.frame_change_post.append(f)').ok).toBe(false)
    expect(guardBlenderCode('bpy.app.timers.register(f)').ok).toBe(false)
    expect(guardBlenderCode('bpy.utils.register_class(Foo)').ok).toBe(false)
    expect(guardBlenderCode('bpy.data.texts["a.py"].as_string()').ok).toBe(false)
    expect(guardBlenderCode('bpy.ops.text.run_script()').ok).toBe(false)
    expect(guardBlenderCode('bpy.ops.preferences.addon_enable(module="x")').ok).toBe(false)
    expect(guardBlenderCode('bpy.ops.wm.append(filepath="a.blend")').ok).toBe(false)
    expect(guardBlenderCode('bpy.ops.wm.save_homefile()').ok).toBe(false)
  })

  it('拦住多行 from-import 括号写法里的禁用名', () => {
    const verdict = guardBlenderCode('from math import (\n    sqrt,\n    system,\n)')
    expect(verdict.ok).toBe(false)
  })

  it('getattr 家族只接受字面量属性名，且不能指向模块命名空间 / 危险属性', () => {
    expect(guardBlenderCode('setattr(obj, "hide_viewport", True)').ok).toBe(true)
    expect(guardBlenderCode('hasattr(obj, "name")').ok).toBe(true)
    expect(guardBlenderCode('getattr(obj, name)').ok).toBe(false)
    expect(guardBlenderCode('getattr(bpy, "ops").x()').ok).toBe(false)
    expect(guardBlenderCode('getattr(obj, "__class__")').ok).toBe(false)
    expect(guardBlenderCode('getattr(bpy, "handlers")').ok).toBe(false)
  })

  it('拦住结构性语法：class / 装饰器 / lambda / global / async / 海象 / 动态造类', () => {
    expect(guardBlenderCode('class Foo:\n    pass').ok).toBe(false)
    expect(guardBlenderCode('@staticmethod\ndef f():\n    pass').ok).toBe(false)
    expect(guardBlenderCode('f = lambda x: x').ok).toBe(false)
    expect(guardBlenderCode('def f():\n    global G\n    G = 1').ok).toBe(false)
    expect(guardBlenderCode('async def f():\n    pass').ok).toBe(false)
    expect(guardBlenderCode('if (n := 1):\n    pass').ok).toBe(false)
    expect(guardBlenderCode('T = type("T", (object,), {})').ok).toBe(false)
  })

  it('空脚本 / 超长脚本 / NUL 字节被拒', () => {
    expect(guardBlenderCode('   ').reason).toBe('脚本为空')
    expect(guardBlenderCode('x = 1\u0000').ok).toBe(false)
    expect(guardBlenderCode('x = 1 # ' + 'a'.repeat(200_001)).ok).toBe(false)
  })

  it('拒绝理由带着可执行的改写指引', () => {
    expect(guardBlenderCode('import os').reason).toContain('只允许')
    expect(guardBlenderCode('eval("1")').reason).toContain('eval()')
  })
})
