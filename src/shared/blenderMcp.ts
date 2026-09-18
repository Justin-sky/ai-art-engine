/**
 * Blender MCP 工具面（共享层：声明式数据 + 纯函数，无 Node / Electron 依赖）。
 *
 * ## 设计取向
 *
 * 参考 llama.cpp 一类的本地能力接入方式：**不带自己的运行时**。旧实现要在用户机器上
 * 装 Python + uv，再 spawn `uvx blender-mcp`，外面还要套一层 stdio→HTTP 反向桥与
 * 一个 JSON 文件轮询握手；这条链上任何一环（uv 未装 / PATH 没有 .local\bin / 孙子进程
 * 崩了 / 握手文件没写出来）都会让工具面静默消失。
 *
 * 重写后只有两段：
 *
 *     dsh / 外部 Agent ──HTTP──▶ 主进程 /mcp/blender ──TCP(7876 类)──▶ Blender addon
 *
 * 也就是说：**MCP server 跑在应用主进程里**，直接以官方 addon 的 TCP 协议对接。
 * 用户侧只多一件事——在 Blender 里启用官方 addon（这一步无法替代：代码必须在 Blender
 * 进程内执行），但不再需要 Python / uv / 任何子进程。
 *
 * ## 对接口径（来自 ahujasid/blender-mcp 的 addon.py，协议版本 7）
 *
 * - 传输：持久 TCP 长连接，**裸 JSON 帧**——没有换行分隔、没有 Content-Length。
 *   addon 侧用 `recv(8192)` 累积 + `json.loads` 成功即切帧；我们反过来同样做
 *   （累积 + JSON.parse 成功即认为帧结束），见主进程 `BlenderSocketClient`。
 * - 请求：`{"type": "<命令串>", "params": {...}}`；addon 用 `handler(**params)` 展开调用，
 *   **多传一个键就是 TypeError**，所以入参必须逐字段白名单搬运，不能整包透传。
 * - 应答：`{"status":"success","result":<handler 返回值>}` 或
 *   `{"status":"error","message":"..."}`；handler 内部自行返回 `{"error": ...}` 时，
 *   外层仍是 success（错误藏在 result 里），两种都要能识别。
 * - `execute_code` 失败时不返回 error dict，而是抛 `Exception(json.dumps({...}))`，
 *   上层包成 `{"status":"error","message":"{\"exception_type\":...}"}`——即 message
 *   里嵌套了一层 JSON 字符串，`parseBlenderReply` 会拆开，把 traceback 原样给模型。
 * - 长命令**没有**进度帧：addon 单条命令一次 sendall，要进度只能自己再发轮询命令。
 *
 * ## 工具面的边界（有意为之）
 *
 * 本表只收录**签名已核实**的命令。上游 addon 还有 Poly Haven / Sketchfab / Poly Pizza /
 * Hyper3D Rodin / Hunyuan3D 等资产库与生成类命令（约 20 个），它们的 `def` 签名无法从
 * 上游公开源码稳定核对，而 `handler(**params)` 的调用方式决定了「猜错参数名 = 运行时
 * TypeError」。宁缺毋滥：先把「读场景 / 执行代码 / 截屏 / 导出」这条主干做对，后续按同一
 * 张表补录（新增一条 BLENDER_TOOLS 即可，主进程与 UI 无需改动）。
 */

import type { McpToolAccess } from './mcpModeAccess'

/** addon socket 默认监听主机（addon.py `BlenderMCPServer.__init__(host='localhost', port=9876)`） */
export const BLENDER_ADDON_DEFAULT_HOST = 'localhost'
/** addon socket 默认端口 */
export const BLENDER_ADDON_DEFAULT_PORT = 9876

/**
 * Blender 工具面在主 MCP 服务上的挂载路径。
 * 与主工具面同端口、不同路径：省掉独立端口池、独立 token 与端口冲突处理。
 */
export const BLENDER_MCP_PATH = '/mcp/blender'

/** 单条命令的默认超时：addon 在主线程阻塞执行，长脚本不要卡死请求 */
export const BLENDER_COMMAND_TIMEOUT_MS = 60_000
/** 探活（ping）超时：addon 未起时要快速失败，让 UI 立刻显示「未连接」 */
export const BLENDER_PING_TIMEOUT_MS = 3_000

/** 截图回传上限：超过就只回文件路径，避免把 MCP 响应撑爆 */
export const BLENDER_SCREENSHOT_MAX_BYTES = 6 * 1024 * 1024

/** safe mode 下脚本体积上限（与上游 safe_mode.py 的 MAX_CODE_BYTES 一致） */
export const BLENDER_CODE_MAX_BYTES = 200_000

/** 注参上下文：截图类命令需要主进程先给出落盘路径（addon 只会往这个路径写文件） */
export interface BlenderParamContext {
  /** 截图落盘绝对路径；仅 `screenshot: true` 的工具会用到 */
  screenshotFilepath: string
}

/**
 * Blender 端 addon 方言：
 * - `community`：ahujasid/blender-mcp 的 addon.py（`{command, params}` 裸 JSON 帧）
 * - `official`：Blender Lab「MCP Server」官方扩展（`{type: "execute", code}` + `\0` 帧）
 */
export type BlenderAddonType = 'community' | 'official'

export interface BlenderToolSpec {
  /** MCP 工具名；沿用上游 blender-mcp 的命名，Agent 既有提示词无需改写 */
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  /** addon.py 命令分发表的键（`{"type": ...}` 的值） */
  command: string
  /** 对话模式授权等级（Ask / Plan 据此收窄工具面，见 mcpModeAccess.ts） */
  access: McpToolAccess
  /** 结果里带图片（addon 写盘 → 主进程读回 → MCP image content） */
  screenshot?: boolean
  /** MCP 入参 → addon handler 关键字参数（逐字段白名单搬运） */
  toParams: (args: Record<string, unknown>, ctx: BlenderParamContext) => Record<string, unknown>
}

// --- 入参读取：缺必填直接抛，错误信息写给模型看 ---------------------------

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`缺少必填参数 ${key}（字符串）`)
  }
  return value
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return undefined
}

function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  return typeof args[key] === 'boolean' ? args[key] : undefined
}

function optionalStringList(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key]
  if (!Array.isArray(value)) return undefined
  const list = value.filter((item): item is string => typeof item === 'string' && !!item.trim())
  return list.length ? list : undefined
}

/** 丢掉 undefined 的键：addon 用 `**params` 展开，多余的键会直接 TypeError */
function compact(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) out[key] = value
  }
  return out
}

// --- 工具表 ---------------------------------------------------------------

export const BLENDER_TOOLS: BlenderToolSpec[] = [
  {
    name: 'get_scene_info',
    title: 'Blender 场景概览',
    description:
      '读取 Blender 当前场景概览：场景名、对象数量、材质数量与前若干对象的名称 / 类型 / 位置。' +
      '只读，不会修改场景。第一次接入 Blender 或需要确认「当前开的哪个文件」时先调它。',
    inputSchema: { type: 'object', properties: {} },
    command: 'get_scene_info',
    access: 'read',
    toParams: () => ({})
  },
  {
    name: 'get_world_state_snapshot',
    title: 'Blender 世界快照',
    description:
      '读取比 get_scene_info 更完整的场景快照：几何 / 关系 / 动画摘要、当前帧与帧范围、FPS、' +
      '选中对象、激活相机与灯光、材质数量等。做多步建模前用它建立完整上下文。只读。',
    inputSchema: { type: 'object', properties: {} },
    command: 'get_world_state_snapshot',
    access: 'read',
    toParams: () => ({})
  },
  {
    name: 'get_object_info',
    title: 'Blender 对象详情',
    description:
      '读取指定对象（object_name，即 Blender 大纲里的对象名）的详情：类型、位置、旋转、缩放、' +
      '可见性、材质，网格对象还会带顶点 / 边 / 面数与世界包围盒。只读。',
    inputSchema: {
      type: 'object',
      properties: {
        object_name: { type: 'string', description: 'Blender 中的对象名（bpy.data.objects 的键）' }
      },
      required: ['object_name']
    },
    command: 'get_object_info',
    access: 'read',
    toParams: (args) => ({ name: requiredString(args, 'object_name') })
  },
  {
    name: 'get_viewport_screenshot',
    title: 'Blender 视口截图',
    description:
      '截取当前 3D 视口画面（优先离屏 GPU 抓帧，失败回退窗口抓屏）。画面会作为图片直接返回，' +
      '可直接用来判断造型、构图与材质效果。只读。注意：需要 Blender 界面处于可见状态。',
    inputSchema: {
      type: 'object',
      properties: {
        max_size: {
          type: 'number',
          description: '画面长边像素上限，默认 800（越大越慢、越占上下文）'
        }
      }
    },
    command: 'get_viewport_screenshot',
    access: 'read',
    screenshot: true,
    toParams: (args, ctx) =>
      compact({
        max_size: optionalNumber(args, 'max_size'),
        filepath: ctx.screenshotFilepath,
        format: 'png'
      })
  },
  {
    name: 'execute_blender_code',
    title: '执行 Blender Python',
    description:
      '在 Blender 进程内执行 Python 代码（等价于 Blender 的「运行脚本」，可完整访问 bpy）。' +
      '脚本里 print 的内容会原样返回。请把任务拆成小步，一次只做一件事，并在每步之后核对结果；' +
      '出错时会返回异常类型、消息与带行号的 traceback。' +
      '开启代码护栏（设置面板 Safe Mode）时，脚本只能 import bpy/bmesh/mathutils 与纯 Python 标准库，' +
      '且禁用 eval/exec/open、os/subprocess/网络访问、handlers/timers/drivers 与类注册；' +
      '渲染、保存、导入导出等 bpy 操作符不受限制。' +
      '若用脚本导出 glb，路径必须写在工程 Cache/Models（或图节点作业的 output.glb），禁止写 Assets/。',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '要执行的 Python 代码' }
      },
      required: ['code']
    },
    command: 'execute_code',
    access: 'write',
    toParams: (args) => ({ code: requiredString(args, 'code') })
  },
  {
    name: 'export_scene',
    title: '导出 Blender 场景',
    description:
      '把场景（或选中对象）导出为 glb（默认，含网格 / 蒙皮 / 动画）。' +
      '对话里的导出会被改写到工程 Cache/Models，不进资产库；对话流会出预览卡，' +
      '由用户点「保存到资产库」。图节点作业目录 Cache/BlenderJobs 下的 output.glb 原样保留。' +
      'filepath 必须是绝对路径；父目录不存在时由本应用创建。',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: { type: 'string', description: '导出文件的绝对路径（含扩展名）' },
        format: {
          type: 'string',
          description: '导出格式，默认 glb；常见取值 glb / gltf / fbx / obj / usd / stl'
        },
        object_names: {
          type: 'array',
          items: { type: 'string' },
          description: '只导出这些对象（不传则按 selection_only 决定选中的还是全部）'
        },
        selection_only: { type: 'boolean', description: '只导出当前选中的对象' },
        apply_modifiers: { type: 'boolean', description: '导出前应用修改器，默认 true' }
      },
      required: ['filepath']
    },
    command: 'export_scene',
    access: 'write',
    toParams: (args) =>
      compact({
        filepath: requiredString(args, 'filepath'),
        format: optionalString(args, 'format'),
        object_names: optionalStringList(args, 'object_names'),
        selection_only: optionalBoolean(args, 'selection_only'),
        apply_modifiers: optionalBoolean(args, 'apply_modifiers')
      })
  },
  {
    name: 'describe_node_type',
    title: 'Blender 节点类型说明',
    description:
      '查询某个节点类型（bl_idname，如 ShaderNodeTexImage）的端口与可设属性，' +
      '写着色器 / 几何节点脚本前用它确认真实的输入名，比自己猜省事得多。只读。',
    inputSchema: {
      type: 'object',
      properties: {
        bl_idname: { type: 'string', description: '节点类型的 bl_idname' },
        property_overrides: {
          type: 'object',
          description: '可选：一组属性覆盖，用于看覆盖后的端口情况'
        }
      },
      required: ['bl_idname']
    },
    command: 'describe_node_type',
    access: 'read',
    toParams: (args) =>
      compact({
        bl_idname: requiredString(args, 'bl_idname'),
        property_overrides: args.property_overrides
      })
  },
  {
    name: 'bpy_api_lookup',
    title: 'bpy API 查询',
    description:
      '在运行中的 Blender 里查询 bpy 的 API：操作符、类型、属性、函数都能查，' +
      '返回的参数名 / 默认值来自真实 RNA，比凭记忆写脚本可靠。只读。',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '查询串，如 bpy.ops.mesh.primitive_cube_add 或 Object.location'
        }
      },
      required: ['query']
    },
    command: 'bpy_api_lookup',
    access: 'read',
    toParams: (args) => ({ query: requiredString(args, 'query') })
  },
  {
    name: 'get_addon_status',
    title: 'Blender addon 状态',
    description:
      '读取 Blender 端 addon 的版本与协议版本、能力清单、Blender 版本。' +
      '工具报「无法连接 Blender」时用它判断是 addon 没启用、版本不匹配，还是 Blender 没开。只读。',
    inputSchema: { type: 'object', properties: {} },
    command: 'get_addon_info',
    access: 'read',
    toParams: () => ({})
  }
]

const BLENDER_TOOL_BY_NAME = new Map(BLENDER_TOOLS.map((tool) => [tool.name, tool]))

export function blenderToolSpec(name: string): BlenderToolSpec | undefined {
  return BLENDER_TOOL_BY_NAME.get(name)
}

/** 工具副作用等级；未登记的名字按 write 兜底（与 mcpModeAccess.toolAccessOf 同一约定） */
export function blenderToolAccessOf(name: string): McpToolAccess {
  return BLENDER_TOOL_BY_NAME.get(name)?.access ?? 'write'
}

/** 供协议层 tools/list 使用的最小描述 */
export function blenderToolDescriptors(): Array<{
  name: string
  title: string
  description: string
  inputSchema: unknown
}> {
  return BLENDER_TOOLS.map(({ name, title, description, inputSchema }) => ({
    name,
    title,
    description,
    inputSchema
  }))
}

/** 把 MCP 入参翻译成 addon 的 `{"type","params"}` 请求体 */
export function buildBlenderCommand(
  spec: BlenderToolSpec,
  args: Record<string, unknown>,
  ctx: BlenderParamContext
): { type: string; params: Record<string, unknown> } {
  return { type: spec.command, params: spec.toParams(args, ctx) }
}

// --- 应答归一 -------------------------------------------------------------

export interface BlenderReply {
  ok: boolean
  /** 成功时的 handler 返回值（原样回给模型，不重排结构） */
  payload?: unknown
  /** 失败原因（已尽量拆开 execute_code 的嵌套 JSON，保留 traceback） */
  error?: string
}

/**
 * 从累积缓冲区里切出**第一个完整的 JSON 帧**；不够一整帧时返回 null（继续等数据）。
 *
 * addon 的传输没有分隔符：既不发换行也不发长度头，只保证「一条命令一次 sendall 一个 JSON」。
 * 所以切帧只能靠「括号配平 + JSON.parse 校验」——用括号配平而不是「整个缓冲区 parse 成功」，
 * 是为了顺带处理 TCP 把两条应答粘在一个 chunk 里的情况（此时整包 parse 必然失败，
 * 于是缓冲区会越堆越大直到超时）。
 *
 * 字符串状态必须自己跟踪：`{"code":"print('}')"}` 里的 `}` 不是帧结束。
 */
export function takeJsonFrame(buffer: string): { frame: string; rest: string } | null {
  const trimmed = buffer.trimStart()
  const offset = buffer.length - trimmed.length
  if (!trimmed) return null
  const open = trimmed[0]
  if (open !== '{' && open !== '[') return null // 流已错位，交给调用方的超时 + 重置兜底
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === open) {
      depth++
      continue
    }
    if (ch !== close) continue
    depth--
    if (depth !== 0) continue
    const frame = trimmed.slice(0, i + 1)
    try {
      JSON.parse(frame)
    } catch {
      return null // 括号配平了但不是合法 JSON：不能当帧交出去
    }
    return { frame, rest: buffer.slice(offset + i + 1) }
  }
  return null
}

/**
 * 归一 addon 的应答。four 种形态都要认：
 * 1. `{"status":"success","result":X}` → 成功，payload = X
 * 2. `{"status":"success","result":{"error":"..."}}` → 失败（handler 自己报的错）
 * 3. `{"status":"error","message":"..."}` → 失败
 * 4. 没有 status 字段（版本差异 / 中间态）→ 整包当 payload，宁可把原文给模型
 */
export function parseBlenderReply(raw: string): BlenderReply {
  const text = raw.trim()
  if (!text) return { ok: false, error: 'Blender addon 返回了空响应' }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {
      ok: false,
      error: `Blender addon 返回了非 JSON 响应（前 200 字符）：${text.slice(0, 200)}`
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: true, payload: parsed }
  }
  const obj = parsed as Record<string, unknown>
  if (obj.status === 'error') {
    return { ok: false, error: formatAddonError(obj.message) }
  }
  const payload = 'result' in obj ? obj.result : obj
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const inner = (payload as Record<string, unknown>).error
    if (typeof inner === 'string' && inner) return { ok: false, error: inner }
  }
  return { ok: true, payload }
}

/**
 * addon 的失败文案有两种来源：`{"status":"error","message":"普通字符串"}`，以及
 * `execute_code` 抛出的 `{"status":"error","message":"{\"exception_type\":...,\"traceback\":...}"}`。
 * 后者要拆开，否则模型看不到行号，改不动脚本。
 */
function formatAddonError(message: unknown): string {
  const text =
    typeof message === 'string' && message.trim()
      ? message.trim()
      : 'Blender addon 报错（无错误信息）'
  if (!text.startsWith('{')) return text
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const parts: string[] = []
    if (typeof parsed.exception_type === 'string') parts.push(`异常类型：${parsed.exception_type}`)
    if (typeof parsed.message === 'string') parts.push(parsed.message)
    if (typeof parsed.traceback === 'string' && parsed.traceback.trim()) {
      parts.push(parsed.traceback.trim())
    }
    return parts.length ? parts.join('\n') : text
  } catch {
    return text
  }
}

// --- 代码护栏（safe mode）-------------------------------------------------

/** 允许 import 的顶层模块：与上游 safe_mode.py 的 ALLOWED_MODULES 对齐 */
const ALLOWED_IMPORT_MODULES = new Set([
  'bpy',
  'bmesh',
  'mathutils',
  'math',
  'cmath',
  'random',
  'colorsys',
  'json',
  'itertools',
  'functools',
  'collections',
  'statistics',
  'string',
  're',
  'enum',
  'dataclasses',
  'typing',
  'decimal',
  'fractions',
  'textwrap',
  'unicodedata',
  'uuid',
  'copy',
  'heapq',
  'bisect',
  'array'
])

/** 允许 import 但整体禁止的子模块（bpy.utils.previews 会把磁盘文件读进 UI 层） */
const DENIED_SUBMODULES = new Set(['bpy.utils.previews', 'collections.abc'])

/** 从允许模块里也禁止按名导入的符号（都是逃脱口） */
const DENIED_IMPORT_NAMES = new Set([
  'system',
  'popen',
  'SystemRandom',
  'previews',
  'path',
  'environ',
  'exit',
  'argv',
  'modules',
  'builtins',
  '__builtins__',
  '__import__',
  '__loader__',
  '__spec__',
  'reload',
  'import_module',
  'find_spec',
  'util'
])

/** 恒禁止的调用：名字 + 危害（写给模型看，便于它改写脚本） */
const FORBIDDEN_CALLS: Array<[string, string]> = [
  ['eval', 'eval() 会执行任意表达式'],
  ['exec', 'exec() 会执行任意代码'],
  ['compile', 'compile() 会产出可执行代码对象'],
  ['__import__', '__import__() 会绕过 import 白名单'],
  ['open', 'open() 提供原始文件系统访问；文件读写请走 bpy 操作符'],
  ['input', 'input() 会在 stdin 上阻塞 Blender 主线程'],
  ['breakpoint', 'breakpoint() 会进入拥有完整进程权限的调试器'],
  ['exit', 'exit() 会终止宿主进程'],
  ['quit', 'quit() 会终止宿主进程'],
  ['globals', 'globals() 会暴露模块命名空间'],
  ['locals', 'locals() 会暴露外层命名空间'],
  ['vars', 'vars() 会暴露对象的 __dict__'],
  ['dir', 'dir() 为动态查找枚举属性'],
  ['help', 'help() 会经 pydoc 导入任意模块'],
  ['memoryview', 'memoryview() 允许裸缓冲区操作'],
  ['super', 'super() 会抵达可能被禁的基类'],
  ['object', '裸 object() 常被用来接 __subclasses__ 链'],
  ['staticmethod', '脚本不需要构造描述符'],
  ['classmethod', '脚本不需要构造描述符'],
  ['property', '脚本不需要构造描述符'],
  ['copyright', 'site 内置会暴露模块内部结构'],
  ['credits', 'site 内置会暴露模块内部结构'],
  ['license', 'site 内置会暴露模块内部结构']
]

/** getattr 家族只允许字面量属性名（计算出来的名字能绕过本模块所有属性检查） */
const LITERAL_ATTR_CALLS = ['getattr', 'setattr', 'delattr', 'hasattr']

/** 只用于「抵达被禁面」的模块导航段：经不可解析的接收者访问时一律拒绝 */
const MODULE_NAVIGATION = new Set([
  'ops',
  'utils',
  'app',
  'props',
  'types',
  'wm',
  'script',
  'preferences'
])

/** 按点号路径禁止的 bpy 子树（渲染 / 保存 / 导入导出**不**在列——那正是本工具要做的事） */
const FORBIDDEN_BPY_PATHS: Array<[string, string]> = [
  ['bpy.app.driver_namespace', 'driver_namespace 会把全局量注入驱动求值'],
  ['bpy.app.handlers', 'handler 注册会让代码在本脚本结束后继续存活'],
  ['bpy.app.timers', 'timer 会让代码在本脚本结束后继续存活'],
  ['bpy.app.binary_path', '暴露 Blender 可执行文件路径，可用于重启进程'],
  ['bpy.utils.register_class', '类注册会让定义在本脚本结束后继续存活'],
  ['bpy.utils.unregister_class', '类注册会让定义在本脚本结束后继续存活'],
  ['bpy.utils.register_classes_factory', '类注册会让定义在本脚本结束后继续存活'],
  ['bpy.utils.execfile', '会执行磁盘上的文件'],
  ['bpy.utils.load_scripts', '会执行磁盘上的脚本'],
  ['bpy.utils.script_paths', '枚举磁盘上的脚本加载位置'],
  ['bpy.utils.user_resource', '解析可写资源路径'],
  ['bpy.utils.modules_from_path', '会从磁盘导入任意模块'],
  ['bpy.utils.refresh_script_paths', '会重新从磁盘加载脚本'],
  ['bpy.data.texts', '文本数据块本身就是一条执行路径（Run Script）'],
  ['bpy.data.scripts', '脚本数据块是一条执行路径'],
  ['bpy.data.libraries', '库加载会链接外部 .blend，可携带代码'],
  ['bpy.props', '属性注册会让定义在本脚本结束后继续存活'],
  ['bpy.types.Operator', '定义操作符等于注册持久代码'],
  ['bpy.types.Panel', '定义面板等于注册持久 UI 代码'],
  ['bpy.types.AddonPreferences', 'addon 偏好类会持久化'],
  ['bpy.types.Macro', '宏会把操作符串起来执行'],
  ['bpy.ops.wm.append', '会从外部 .blend 追加数据块（代码可随之而来）'],
  ['bpy.ops.wm.link', '会从外部 .blend 链接数据块（代码可随之而来）'],
  ['bpy.ops.wm.lib_relocate', '把库指向任意 .blend'],
  ['bpy.ops.wm.lib_reload', '会从磁盘重载库'],
  ['bpy.ops.wm.save_homefile', '会覆盖用户的启动文件'],
  ['bpy.ops.wm.url_open', '会在用户浏览器里打开 URL'],
  ['bpy.ops.wm.path_open', '会用系统默认程序打开路径'],
  ['bpy.ops.wm.console_toggle', '会开出交互式 Python 控制台'],
  ['bpy.ops.wm.quit_blender', '会终止宿主进程'],
  ['bpy.ops.render.play_rendered_anim', '会拉起外部播放器进程']
]

/** 整棵子树都禁的 bpy.ops 前缀（每个操作符都在执行代码） */
const FORBIDDEN_OPS_PREFIXES: Array<[string, string]> = [
  ['bpy.ops.script', 'bpy.ops.script.* 会执行 Python'],
  ['bpy.ops.text', 'bpy.ops.text.* 会运行文本数据块'],
  ['bpy.ops.preferences', 'bpy.ops.preferences.* 会安装并启用 addon'],
  ['bpy.ops.console', 'bpy.ops.console.* 会执行任意 Python']
]

/** 属性名无论挂在什么对象上都禁（接收者不一定能被静态解析出来） */
const FORBIDDEN_BARE_ATTRS: Array<[string, string]> = [
  ['driver_namespace', '会把全局量注入驱动表达式求值'],
  ['register_class', '类注册会让定义在本脚本结束后继续存活'],
  ['unregister_class', '类注册会让定义在本脚本结束后继续存活'],
  ['execfile', '会执行磁盘上的文件'],
  ['load_scripts', '会执行磁盘上的脚本'],
  ['save_homefile', '会覆盖用户的启动文件'],
  ['quit_blender', '会终止宿主进程'],
  ['url_open', '会在用户浏览器里打开 URL'],
  ['path_open', '会用系统默认程序打开路径'],
  ['console_toggle', '会开出交互式 Python 控制台'],
  ['as_pointer', '会泄漏可与 ctypes 配合使用的裸内存地址'],
  ['driver_add', '驱动会在每帧求值 Python 表达式'],
  ['driver_remove', '驱动操作属于驱动求值面'],
  ['texts', '文本数据块是一条执行路径（Run Script）'],
  ['scripts', '脚本数据块是一条执行路径'],
  ['libraries', '库加载会链接外部 .blend，可携带代码'],
  ['handlers', 'handler 注册会让代码在本脚本结束后继续存活'],
  ['timers', 'timer 会让代码在本脚本结束后继续存活'],
  ['binary_path', '暴露 Blender 可执行文件路径，可用于重启进程'],
  ['user_resource', '解析可写资源路径'],
  ['script_paths', '枚举磁盘上的脚本加载位置'],
  ['modules_from_path', '会从磁盘导入任意模块'],
  ['python_file_run', '会执行磁盘上的 Python 文件'],
  ['run_script', '会把文本数据块当 Python 执行'],
  ['addon_install', '会从磁盘安装 addon'],
  ['addon_enable', '会启用 addon，执行其模块级代码']
]

/** 赋值即等于「存下一段 Blender 稍后求值的 Python 表达式」 */
const FORBIDDEN_ASSIGN_ATTRS: Array<[string, string]> = [
  ['expression', '驱动表达式会被 Blender 当作 Python 求值'],
  ['script', '脚本节点会执行它被指派的数据库块'],
  ['use_self', '会开启驱动表达式对宿主数据块的访问'],
  ['script_directory', '会改掉 Blender 的脚本搜索路径'],
  ['use_scripts_auto_execute', '会开启内嵌脚本的自动执行']
]

export interface BlenderCodeGuardResult {
  ok: boolean
  /** 不通过时的原因（写给模型看，带可执行的改写指引） */
  reason: string
}

function violation(reason: string): BlenderCodeGuardResult {
  return { ok: false, reason }
}

/**
 * 把 Python 源码里的注释与非 f-string 字面量内容抹掉，保留引号与行结构。
 *
 * 目的是让「名字 / 路径 / 关键字」规则不被字符串与注释里的词误伤
 * （例如脚本里写 `print("bpy.ops.script")` 不该被判违规）。f-string 的 `{expr}` 是
 * 真实代码，所以 f-string 原样保留——宁可误报，不可漏检。
 */
export function maskPythonLiterals(code: string): string {
  let out = ''
  let i = 0
  const n = code.length
  while (i < n) {
    const ch = code[i]
    if (ch === '#') {
      let j = i
      while (j < n && code[j] !== '\n') j++
      out += ' '
      i = j
      continue
    }
    if (ch !== "'" && ch !== '"') {
      out += ch
      i++
      continue
    }
    const quote = ch
    const triple = code.startsWith(quote.repeat(3), i)
    const closer = triple ? quote.repeat(3) : quote
    // f-string：紧邻标识符 f/F 且其前不是标识符字符（排除 foo"..." 这类误判）
    const prev = i > 0 ? code[i - 1] : ''
    const prev2 = i > 1 ? code[i - 2] : ''
    const fString = (prev === 'f' || prev === 'F') && !/[A-Za-z0-9_]/.test(prev2)
    let j = i + closer.length
    while (j < n) {
      if (code[j] === '\\') {
        j += 2
        continue
      }
      if (!triple && code[j] === '\n') break
      if (code.startsWith(closer, j)) break
      j++
    }
    const end = Math.min(j + closer.length, n)
    out += fString ? code.slice(i, end) : quote
    i = end
  }
  return out
}

function checkImports(masked: string): string | null {
  const lines = masked.split('\n')
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const plain = /^[ \t]*import[ \t]+(.+)$/.exec(line)
    if (plain) {
      for (const raw of plain[1].split(',')) {
        const item = raw.trim()
        if (!item) continue
        const [module, alias] = item.split(/\s+as\s+/)
        const root = module.trim().split('.')[0]
        if (alias) {
          return `不允许 import 别名（${item}）：别名会让路径检查认不出这个模块`
        }
        if (!ALLOWED_IMPORT_MODULES.has(root)) {
          return `不允许 import ${module.trim()}：只允许 bpy / bmesh / mathutils 与纯 Python 标准库`
        }
        if (DENIED_SUBMODULES.has(module.trim())) {
          return `不允许 import ${module.trim()}`
        }
      }
      continue
    }
    const fromMatch = /^[ \t]*from[ \t]+([.\w]+)[ \t]+import[ \t]+(.*)$/.exec(line)
    if (!fromMatch) continue
    const module = fromMatch[1]
    let namesText = fromMatch[2]
    // 括号换行的 from-import：把后续行并进来再解析
    let cursor = index
    while (namesText.includes('(') && !namesText.includes(')') && cursor + 1 < lines.length) {
      cursor++
      namesText += ' ' + lines[cursor]
    }
    const root = module.split('.')[0]
    if (module.startsWith('.')) return '不允许相对导入'
    if (DENIED_SUBMODULES.has(module)) return `不允许 from ${module} import`
    if (!ALLOWED_IMPORT_MODULES.has(root)) {
      return `不允许 from ${module} import：只允许 bpy / bmesh / mathutils 与纯 Python 标准库`
    }
    if (root === 'bpy') {
      return '不允许 from bpy import ...：请用 import bpy + 完整点号路径，这样路径规则才检查得到'
    }
    for (const raw of namesText.replace(/[()]/g, '').split(',')) {
      const name = raw.trim()
      if (!name) continue
      if (name === '*') return '不允许通配 import：它隐藏了进入命名空间的东西'
      if (DENIED_IMPORT_NAMES.has(name)) return `不允许 from ${module} import ${name}`
      if (name.startsWith('_')) return `不允许导入私有名 ${name}`
    }
    index = cursor
  }
  return null
}

function checkLiteralAttrCalls(code: string): string | null {
  const re = new RegExp(`\\b(${LITERAL_ATTR_CALLS.join('|')})\\s*\\(([^)]*)\\)`, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(code))) {
    const name = match[1]
    const args = match[2]
    const comma = args.indexOf(',')
    if (comma < 0) return `${name}() 必须显式给出字面量属性名`
    const target = args.slice(comma + 1).trim()
    const literal = /^['"]([^'"]*)['"]/.exec(target)
    if (!literal) {
      return `${name}() 的属性名必须是字面量字符串，不能是计算出来的表达式`
    }
    const attr = literal[1]
    if (/^__.*__$/.test(attr)) return `${name}() 指向了逃脱用的属性 ${attr}`
    if (MODULE_NAVIGATION.has(attr)) {
      return `${name}() 指向了模块命名空间 ${attr}；命名空间只能经可检查的点号路径访问`
    }
    const bare = FORBIDDEN_BARE_ATTRS.find(([key]) => key === attr)
    if (bare) return `${name}() 指向了 ${attr}：${bare[1]}`
    if (name !== 'hasattr') {
      const assign = FORBIDDEN_ASSIGN_ATTRS.find(([key]) => key === attr)
      if (assign) return `${name}() 指向了 ${attr}：${assign[1]}`
    }
  }
  return null
}

/**
 * safe mode 的代码护栏。
 *
 * **这不是沙箱，是词法护栏**。上游 blender-mcp 在 MCP server 侧跑的是一个 Python AST
 * 白名单校验器（safe_mode.py）；Node 侧没有可用的 Python 解析器，因此这里实现的是
 * 「同名同类规则」的词法近似：抹掉注释与字面量后按名字 / 点号路径 / 关键字匹配。
 *
 * 它拦得住的是**模型被提示注入后写出来的那类脚本**（eval/exec、os/subprocess、
 * handlers/timers、类注册、外部 .blend 加载……），因为那些都是「结构性」写法；
 * 它拦不住刻意混淆的写法（比如经不可解析的接收者绕路访问模块命名空间）。
 *
 * 真正的兜底不在这层：面板的 Ask / Plan 模式在 MCP 请求级收窄工具面
 * （见 shared/mcpModeAccess.ts），且 addon 的 socket 本身只监听本机。
 */
export function guardBlenderCode(code: string): BlenderCodeGuardResult {
  if (typeof code !== 'string' || !code.trim()) return violation('脚本为空')
  if (new TextEncoder().encode(code).length > BLENDER_CODE_MAX_BYTES) {
    return violation(`脚本超过 ${BLENDER_CODE_MAX_BYTES} 字节`)
  }
  if (code.includes('\u0000')) return violation('脚本包含 NUL 字节')

  const masked = maskPythonLiterals(code)

  for (const [name, why] of FORBIDDEN_CALLS) {
    if (new RegExp(`(?<![\\w.])${name}\\s*\\(`).test(masked)) {
      return violation(`${name}() 被禁止：${why}`)
    }
  }
  // 注意这里**要**命中属性访问形式（`obj.__class__`）：逃脱链正是从点号后面的 dunder 开始的，
  // 所以边界只排除标识符字符，不排除点号（与 FORBIDDEN_CALLS 的边界规则相反）。
  if (/(?<![A-Za-z0-9_])__[A-Za-z_]\w*__/.test(masked)) {
    return violation('禁止双下划线（dunder）名称：解释器逃脱链正是从这里开始的')
  }
  for (const [attr, why] of FORBIDDEN_BARE_ATTRS) {
    if (new RegExp(`\\.${attr}\\b`).test(masked)) {
      return violation(`.${attr} 被禁止：${why}`)
    }
  }
  for (const [attr, why] of FORBIDDEN_ASSIGN_ATTRS) {
    if (new RegExp(`\\.${attr}\\s*(?==)`).test(masked)) {
      return violation(`赋值 ${attr} 被禁止：${why}`)
    }
  }
  for (const [path, why] of FORBIDDEN_BPY_PATHS) {
    const escaped = path.replace(/\./g, '\\.')
    if (new RegExp(`(?<![\\w.])${escaped}\\b`).test(masked)) {
      return violation(`${path} 被禁止：${why}`)
    }
  }
  for (const [prefix, why] of FORBIDDEN_OPS_PREFIXES) {
    const escaped = prefix.replace(/\./g, '\\.')
    if (new RegExp(`(?<![\\w.])${escaped}\\.`).test(masked)) {
      return violation(`${prefix}.* 被禁止：${why}`)
    }
  }

  const importProblem = checkImports(masked)
  if (importProblem) return violation(importProblem)

  const attrCallProblem = checkLiteralAttrCalls(code)
  if (attrCallProblem) return violation(attrCallProblem)

  if (/^[ \t]*class[ \t]+\w+/m.test(masked)) {
    return violation('禁止定义类：类定义是注册持久 bpy 类型的入口')
  }
  if (/^[ \t]*@/m.test(masked)) {
    return violation('禁止装饰器：它会把任意可调用对象套到函数对象上')
  }
  if (/\blambda\b/.test(masked)) {
    return violation('禁止 lambda：匿名间接层会隐藏真正的调用目标，请改用 def')
  }
  if (/^[ \t]*(global|nonlocal)[ \t]/m.test(masked)) {
    return violation('禁止 global / nonlocal：重绑定外层名字是夹带能力的手法')
  }
  if (/\b(async|await|yield)\b/.test(masked)) {
    return violation(
      '禁止 async / await / yield：Blender 主线程没有事件循环，生成器会推迟到校验之外执行'
    )
  }
  if (/:=/.test(masked)) {
    return violation('禁止海象运算符 :=：表达式内绑定名字会让调用目标分析失真')
  }
  // 在**未抹字面量**的源码上判：三个位置参数里通常有字符串，抹掉就没法数逗号了
  if (/\btype\s*\([^)]*,[^)]*,/.test(code)) {
    return violation('禁止 type(name, bases, ns) 动态造类：类对象会被注册进 bpy 命名空间')
  }
  return { ok: true, reason: '' }
}
