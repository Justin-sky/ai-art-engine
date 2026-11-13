import type { ImageContent, TextContent } from '@earendil-works/pi-ai'
import { isToolVisible, type McpAccessView, type McpToolAccess } from '@shared/mcpModeAccess'
import type { McpRequestContext, McpToolCallOutcome } from '@shared/mcpProtocol'
import type { ExternalMcpServer } from '@shared/externalMcp'
import {
  prepareLooseToolArguments,
  type RuntimeAgentTool,
  type RuntimeToolResult
} from './piModelResolver'

/**
 * 单次请求激活工具总上限（含原生工具 + studio_core + 动态懒加载工具集）。
 * 严格控制在 96 以内，为 OpenAI 128 硬上限预留充足安全余量，从根源杜绝 400 tools array too long。
 */
export const MAX_ACTIVE_TOOLS = 96

/** 单个外部大型 MCP 服务（如 150+ 工具的 rea）单次按相关性挂载的工具上限 */
export const MAX_EXTERNAL_TOOLS_PER_LOAD = 32

export interface LazyMcpToolDescriptor {
  name: string
  title?: string
  description: string
  inputSchema: Record<string, unknown>
  access: McpToolAccess
  source: 'studio' | 'blender' | 'external'
  serverId?: string
  serverName?: string
}

export interface LazyMcpBackend {
  listStudioAndBlenderTools: () => LazyMcpToolDescriptor[]
  listExternalServers: () => Array<Pick<ExternalMcpServer, 'id' | 'name'>>
  listExternalTools: (serverId: string) => Promise<LazyMcpToolDescriptor[]>
  callMcpTool: (
    name: string,
    args: Record<string, unknown>,
    ctx?: McpRequestContext
  ) => Promise<McpToolCallOutcome>
}

export interface ToolsetCatalogEntry {
  id: string
  title: string
  description: string
  toolNames: ReadonlyArray<string>
  prewarmPattern: RegExp
}

/**
 * 常驻核心工具集（12 个）：覆盖 90% 的画布读写、节点查询、任务运行与工程概览，无需额外加载即可直接开干。
 */
export const STUDIO_CORE_TOOL_NAMES = [
  'app_status',
  'project_list',
  'project_memory_read',
  'asset_list',
  'asset_create',
  'models_list',
  'graph_node_types',
  'graph_read',
  'graph_edit',
  'task_run',
  'task_status',
  'render_svg'
] as const

const STUDIO_CORE_SET = new Set<string>(STUDIO_CORE_TOOL_NAMES)

/**
 * 6 大内置按需懒加载工具域：将剩余 80+ Studio 工具与 9 个 Blender 工具按业务职责精准分包。
 */
export const BUILTIN_LAZY_TOOLSETS: ReadonlyArray<ToolsetCatalogEntry> = [
  {
    id: 'project_assets',
    title: '工程文件、资产管理、对象存储与质检',
    description:
      '打开/创建工程、写入工程记忆、读写/导入/移动/删除资产与文件夹、资产质检修复、图标精修、已安装工作流蓝图、对象存储上传与 Git 状态对比。',
    toolNames: [
      'project_open',
      'project_create',
      'project_memory_write',
      'project_memory_append',
      'asset_read_file',
      'asset_write_text',
      'folder_list',
      'folder_create',
      'folder_move',
      'asset_import',
      'asset_rename',
      'asset_move',
      'asset_delete',
      'storage_status',
      'storage_upload',
      'asset_package_export',
      'asset_package_import',
      'asset_qc',
      'asset_qc_fix',
      'graph_icon_refine',
      'workflow_use_installed',
      'decide',
      'project_git_status',
      'project_git_diff'
    ],
    prewarmPattern:
      /\b(git\s+(status|diff)|storage_upload|oss|s3|r2|asset_import|asset_qc|workflow_use_installed|ancient-scroll-revive)\b|(导入资产|质检|对象存储|记忆写入|切换工程|新建工程|打包导出)/i
  },
  {
    id: 'video_timeline_audio',
    title: '视频语义拆解、时间线剪辑与语音音频工具',
    description:
      '音色档案管理、语音转写字幕、人声伴奏分离、视频语义拆解、时间线读写/粗剪/编辑/帧预览/成片导出、视频抽帧与关键帧节拍检测、B站片段抓取。',
    toolNames: [
      'voice_profile_list',
      'voice_profile_upsert',
      'voice_profile_delete',
      'transcribe_audio',
      'audio_separate',
      'semantic_analyze_video',
      'semantic_timeline_read',
      'timeline_read',
      'timeline_rough_cut',
      'timeline_export',
      'timeline_edit',
      'timeline_preview',
      'video_job_list',
      'video_job_get',
      'extract_video_frames',
      'grab_video_frames',
      'detect_video_keyframes',
      'analyze_video_beats',
      'web_fetch_video'
    ],
    prewarmPattern:
      /\b(timeline|rough[_\s-]?cut|transcribe|subtitle|keyframe|bilibili|bv1[0-9a-z]+|voice_profile|audio_separate)\b|(时间线|粗剪|剪辑|字幕|转写|人声分离|抽帧|关键帧|卡点|鬼畜|音色档案)/i
  },
  {
    id: 'director_3d_blender',
    title: '3D 导演舞台、Spine 导出与 Blender 建模绑定工具',
    description:
      '3D 导演台场景读写、3D 模型动画枚举、2D 舞台 Spine 导出，以及 Blender MCP 全套场景查询、截图、Python 代码执行、绑骨蒙皮与导出。',
    toolNames: [
      'director_stage_read',
      'director_stage_edit',
      'list_model3d_animations',
      'stage2d_spine_export',
      'get_scene_info',
      'get_world_state_snapshot',
      'get_object_info',
      'get_viewport_screenshot',
      'execute_blender_code',
      'export_scene',
      'describe_node_type',
      'bpy_api_lookup',
      'get_addon_status'
    ],
    prewarmPattern:
      /\b(blender|bpy|armature|rig|rigging|glb|gltf|fbx|spine|director_stage|execute_blender_code|get_scene_info)\b|(导演台|骨骼|绑骨|蒙皮|权重|3d\s*舞台|视口截图)/i
  },
  {
    id: 'game_production',
    title: '可玩 HTML 游戏、Machinations 数值仿真与游戏资产管线',
    description:
      '一句话可玩游戏创建、自定义玩法工程初始化与构建冒烟测试、Machinations 构件库与数值调优工作台、游戏 UI 套件、瓦片地图/PBR/音效变体/着色器粒子生成。',
    toolNames: [
      'gameplay_prepare_project',
      'gameplay_build',
      'gameplay_job_status',
      'game_tile_pbr_process',
      'game_audio_variants',
      'game_bundle_export',
      'game_data_table_generate',
      'game_level_map_generate',
      'game_shader_particle_generate',
      'game_systems_graph_generate',
      'game_one_sentence_create',
      'game_ui_suite_create',
      'game_playable_preview_compile',
      'machinations_building_blocks',
      'machinations_studio'
    ],
    prewarmPattern:
      /\b(gameplay_|game_one_sentence|machinations|playable|pbr|tilemap|game_ui_suite)\b|(一句话游戏|可玩游戏|小游戏|肉鸽|幸存者|塔防|视觉小说|卡牌对战|瓦片地图)/i
  },
  {
    id: 'tutorial_recording',
    title: '应用界面自动化演示与教程录屏合成',
    description:
      '启动/推进/等待/停止应用内操作录屏、查询控件坐标并触发真实点击、合成带配音与字幕的教程视频。',
    toolNames: [
      'screen_record_start',
      'screen_record_step',
      'screen_record_wait',
      'screen_record_stop',
      'screen_record_status',
      'ui_bounds',
      'ui_click',
      'tutorial_compose'
    ],
    prewarmPattern:
      /\b(screen_record|tutorial_compose|ui_bounds|ui_click)\b|(录制.*教程|教程录制|录屏演示)/i
  },
  {
    id: 'skills_web_vision',
    title: '网页正文提取、在线技能安装、本地 OCR/YOLO 视觉与定时列表',
    description:
      '无头浏览器提取微信公众号/知乎/技术文章正文与配图、GitHub/技能市场搜索安装卸载、本地离线 OCR 文字识别与 YOLO 目标分割姿态检测、定时任务查看。',
    toolNames: [
      'web_extract_article',
      'skill_list',
      'skill_search',
      'skill_inspect_github',
      'skill_install',
      'skill_uninstall',
      'vision_local_ocr',
      'vision_local_yolo',
      'schedule_list',
      'schedule_delete'
    ],
    prewarmPattern:
      /\b(https?:\/\/\S+|skill_search|skill_install|SKILL\.md|ocr|yolo|web_extract_article)\b|(公众号|知乎|掘金|安装技能|搜索技能|文字识别|目标检测)/i
  }
]

const ASSIGNED_BUILTIN_LAZY_NAMES = new Set<string>(
  BUILTIN_LAZY_TOOLSETS.flatMap((entry) => entry.toolNames)
)

function tokenizeQuery(text: string): string[] {
  const normalized = text.toLowerCase()
  const latin = normalized.match(/[a-z0-9_]{2,}/g) ?? []
  const cjk = normalized.match(/[\u4e00-\u9fa5]{2,}/g) ?? []
  return Array.from(new Set([...latin, ...cjk]))
}

/**
 * 对超大型外部 MCP 服务（如 rea 的 150+ 工具）按查询词与提示词打分筛选最相关的子集。
 */
export function selectRelevantExternalTools(
  allTools: ReadonlyArray<LazyMcpToolDescriptor>,
  query: string,
  limit = MAX_EXTERNAL_TOOLS_PER_LOAD
): {
  selected: LazyMcpToolDescriptor[]
  omittedNames: string[]
} {
  if (allTools.length <= limit) {
    return { selected: [...allTools], omittedNames: [] }
  }
  const tokens = tokenizeQuery(query)
  if (tokens.length === 0) {
    return {
      selected: allTools.slice(0, limit),
      omittedNames: allTools.slice(limit).map((t) => t.name)
    }
  }

  const scored = allTools.map((tool, index) => {
    const nameLower = tool.name.toLowerCase()
    const descLower = (tool.description || '').toLowerCase()
    let score = 0
    for (const token of tokens) {
      if (nameLower === token || nameLower.endsWith(`__${token}`)) {
        score += 30
      } else if (nameLower.includes(token)) {
        score += 12
      }
      if (descLower.includes(token)) {
        score += 4
      }
    }
    return { tool, score, index }
  })

  scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index))
  const selected = scored.slice(0, limit).map((entry) => entry.tool)
  const omittedNames = scored.slice(limit).map((entry) => entry.tool.name)
  return { selected, omittedNames }
}

function serializeToolOutcomeContent(outcome: McpToolCallOutcome): (TextContent | ImageContent)[] {
  const blocks: (TextContent | ImageContent)[] = []
  if (outcome.error) {
    blocks.push({ type: 'text', text: outcome.error })
    return blocks
  }
  const text =
    typeof outcome.result === 'string'
      ? outcome.result
      : JSON.stringify(outcome.result ?? { ok: true })
  blocks.push({ type: 'text', text })
  if (Array.isArray(outcome.images)) {
    for (const img of outcome.images) {
      if (img && typeof img.data === 'string' && img.data && typeof img.mimeType === 'string') {
        blocks.push({
          type: 'image',
          data: img.data,
          mimeType: img.mimeType
        })
      }
    }
  }
  return blocks
}

export interface ToolsetDirectorySummary {
  id: string
  title: string
  description: string
  toolCount?: number
  loaded: boolean
}

export interface LoadToolsetOutcome {
  loaded: Array<{
    id: string
    mountedTools: string[]
    omittedCount?: number
    sampleOmittedTools?: string[]
  }>
  evictedToolsets: string[]
  unknownToolsets: string[]
  activeToolCount: number
  maxActiveTools: number
}

interface MountedToolsetRecord {
  id: string
  tools: LazyMcpToolDescriptor[]
  lastUsedSeq: number
}

export interface McpLazyToolsetManagerOptions {
  backend: LazyMcpBackend
  getRequestContext: () => McpRequestContext
  getAccessView: () => McpAccessView
  onToolsChanged?: () => void
  maxActiveTools?: number
  maxExternalToolsPerLoad?: number
  initialToolsetIds?: ReadonlyArray<string>
}

/**
 * 会话级 MCP 按需懒加载与 LRU 容量管理器。
 *
 * 核心职责：
 * 1. 维护 `studio_core` 常驻工具与 6 大内建懒加载包 + `ext:<serverId>` 外部 MCP 动态包。
 * 2. 提供 `load_toolset` 原生工具，模型可在任意轮次一次性挂载所需工具域，下个 LLM 请求立即生效。
 * 3. 在首轮前按用户意图零轮次预热高置信度工具包（如 Blender / 剪辑 / 游戏 / 外部逆向工具）。
 * 4. 严格执行全局 `MAX_ACTIVE_TOOLS = 96`（恒 < 128）与 LRU 淘汰，彻底根除工具超限 400 报错。
 */
export class McpLazyToolsetManager {
  private readonly backend: LazyMcpBackend
  private readonly getRequestContext: () => McpRequestContext
  private readonly getAccessView: () => McpAccessView
  private readonly onToolsChanged?: () => void
  private readonly maxActiveTools: number
  private readonly maxExternalToolsPerLoad: number

  private readonly mounted = new Map<string, MountedToolsetRecord>()
  private readonly externalToolCache = new Map<string, LazyMcpToolDescriptor[]>()
  private readonly agentToolCache = new Map<string, RuntimeAgentTool>()
  private useSeq = 0
  private nativeToolsProvider: () => RuntimeAgentTool[] = () => []

  constructor(options: McpLazyToolsetManagerOptions) {
    this.backend = options.backend
    this.getRequestContext = options.getRequestContext
    this.getAccessView = options.getAccessView
    this.onToolsChanged = options.onToolsChanged
    this.maxActiveTools = options.maxActiveTools ?? MAX_ACTIVE_TOOLS
    this.maxExternalToolsPerLoad = options.maxExternalToolsPerLoad ?? MAX_EXTERNAL_TOOLS_PER_LOAD

    if (options.initialToolsetIds?.length) {
      for (const id of options.initialToolsetIds) {
        this.mountBuiltinSync(id)
      }
    }
  }

  /** 绑定会话固定原生工具列表读取器（用于精确核算总工具预算并执行 LRU 淘汰） */
  setNativeToolsProvider(provider: () => RuntimeAgentTool[]): void {
    this.nativeToolsProvider = provider
  }

  /** 当前已挂载的懒加载工具集 ID 列表（供会话持久化恢复） */
  getLoadedToolsetIds(): string[] {
    return Array.from(this.mounted.keys())
  }

  /** 标记某个工具刚被调用，刷新其所属懒加载工具包的 LRU 活跃序号 */
  touchTool(toolName: string): void {
    for (const record of this.mounted.values()) {
      if (record.tools.some((t) => t.name === toolName)) {
        record.lastUsedSeq = ++this.useSeq
      }
    }
  }

  /** 生成供系统提示词嵌入的工具包目录摘要 */
  getDirectorySummaries(): ToolsetDirectorySummary[] {
    const allStudioAndBlender = this.backend.listStudioAndBlenderTools()
    const availableNames = new Set(allStudioAndBlender.map((t) => t.name))
    const summaries: ToolsetDirectorySummary[] = []

    for (const entry of BUILTIN_LAZY_TOOLSETS) {
      const count = entry.toolNames.filter((name) => availableNames.has(name)).length
      if (count === 0) continue
      summaries.push({
        id: entry.id,
        title: entry.title,
        description: entry.description,
        toolCount: count,
        loaded: this.mounted.has(entry.id)
      })
    }

    for (const ext of this.backend.listExternalServers()) {
      const id = `ext:${ext.id}`
      const cached = this.externalToolCache.get(ext.id)
      summaries.push({
        id,
        title: `外部 MCP 服务「${ext.name || ext.id}」`,
        description: `按需挂载外部 MCP 服务 ${ext.name || ext.id} 的工具（工具名前缀 ${ext.id}__*；大型服务支持传入 query 关键词精准筛选）。`,
        ...(cached ? { toolCount: cached.length } : {}),
        loaded: this.mounted.has(id)
      })
    }

    return summaries
  }

  private resolveBuiltinDescriptors(toolsetId: string): LazyMcpToolDescriptor[] | null {
    const all = this.backend.listStudioAndBlenderTools()
    const byName = new Map(all.map((t) => [t.name, t]))
    const entry = BUILTIN_LAZY_TOOLSETS.find((item) => item.id === toolsetId)
    if (!entry) return null

    const descriptors: LazyMcpToolDescriptor[] = []
    for (const name of entry.toolNames) {
      const found = byName.get(name)
      if (found) descriptors.push(found)
    }

    // 兜底：若未来新增了未归类的内建工具，自动归入 project_assets，确保没有任何工具成为孤岛
    if (toolsetId === 'project_assets') {
      for (const tool of all) {
        if (!STUDIO_CORE_SET.has(tool.name) && !ASSIGNED_BUILTIN_LAZY_NAMES.has(tool.name)) {
          descriptors.push(tool)
        }
      }
    }
    return descriptors
  }

  private mountBuiltinSync(rawId: string): LazyMcpToolDescriptor[] | null {
    const descriptors = this.resolveBuiltinDescriptors(rawId)
    if (!descriptors) return null
    this.mounted.set(rawId, {
      id: rawId,
      tools: descriptors,
      lastUsedSeq: ++this.useSeq
    })
    return descriptors
  }

  private normalizeToolsetId(rawId: string): string {
    const trimmed = rawId.trim()
    if (!trimmed) return ''
    if (BUILTIN_LAZY_TOOLSETS.some((item) => item.id === trimmed)) return trimmed
    if (trimmed.startsWith('ext:')) return trimmed
    const extServers = this.backend.listExternalServers()
    const matchedExt = extServers.find(
      (s) =>
        s.id.toLowerCase() === trimmed.toLowerCase() ||
        s.name.toLowerCase() === trimmed.toLowerCase()
    )
    if (matchedExt) return `ext:${matchedExt.id}`
    return trimmed
  }

  /**
   * 按需挂载一个或多个工具包（支持内建包与 `ext:<serverId>` 外部 MCP 包），并执行 LRU 容量治理。
   */
  async loadToolsets(requestedIds: ReadonlyArray<string>, query = ''): Promise<LoadToolsetOutcome> {
    const loaded: LoadToolsetOutcome['loaded'] = []
    const unknownToolsets: string[] = []
    const justLoadedIds = new Set<string>()

    for (const raw of requestedIds) {
      const id = this.normalizeToolsetId(raw)
      if (!id) continue

      if (id.startsWith('ext:')) {
        const serverId = id.slice('ext:'.length)
        const extExists = this.backend.listExternalServers().some((s) => s.id === serverId)
        if (!extExists) {
          unknownToolsets.push(raw)
          continue
        }
        let allExtTools = this.externalToolCache.get(serverId)
        if (!allExtTools) {
          allExtTools = await this.backend.listExternalTools(serverId)
          if (allExtTools.length > 0) {
            this.externalToolCache.set(serverId, allExtTools)
          }
        }
        const { selected, omittedNames } = selectRelevantExternalTools(
          allExtTools,
          query,
          this.maxExternalToolsPerLoad
        )
        // 若此前已挂载同服务的其它工具，且容量允许，优先以最新筛选集覆盖，保持高相关度与精简体积
        this.mounted.set(id, {
          id,
          tools: selected,
          lastUsedSeq: ++this.useSeq
        })
        justLoadedIds.add(id)
        loaded.push({
          id,
          mountedTools: selected.map((t) => t.name),
          ...(omittedNames.length > 0
            ? {
                omittedCount: omittedNames.length,
                sampleOmittedTools: omittedNames.slice(0, 24)
              }
            : {})
        })
        continue
      }

      const builtin = this.mountBuiltinSync(id)
      if (!builtin) {
        unknownToolsets.push(raw)
        continue
      }
      justLoadedIds.add(id)
      loaded.push({
        id,
        mountedTools: builtin.map((t) => t.name)
      })
    }

    const evictedToolsets = this.enforceActiveToolCeiling(justLoadedIds)
    this.onToolsChanged?.()

    return {
      loaded,
      evictedToolsets,
      unknownToolsets,
      activeToolCount: this.buildActiveTools().length,
      maxActiveTools: this.maxActiveTools
    }
  }

  /**
   * 首轮意图零开销预热：根据用户输入自动挂载明显命中的领域工具包或外部 MCP 服务，
   * 省去一次显式 `load_toolset` 往返，同时严格遵守 `MAX_ACTIVE_TOOLS = 96`。
   */
  async prewarmForPrompt(promptText: string): Promise<string[]> {
    const text = String(promptText ?? '').trim()
    if (!text) return []

    const candidates: string[] = []
    for (const entry of BUILTIN_LAZY_TOOLSETS) {
      if (entry.prewarmPattern.test(text) && !this.mounted.has(entry.id)) {
        candidates.push(entry.id)
      }
    }

    const lower = text.toLowerCase()
    const reverseEngIntent =
      /\b(reverse[-\s]?engineer|decompile|disassembl|apk|xapk|dex|macho|elf|pe\b|frida|gdb|rizin|objdump|ghidra|ida|il2cpp)\b|(逆向|反编译|解包|脱壳|二进制分析|汇编|符号表)/i.test(
        text
      )
    for (const ext of this.backend.listExternalServers()) {
      const extId = `ext:${ext.id}`
      const mentionsServer =
        lower.includes(ext.id.toLowerCase()) ||
        (ext.name && lower.includes(ext.name.toLowerCase())) ||
        (ext.id.toLowerCase() === 'rea' && reverseEngIntent)
      if (mentionsServer) {
        candidates.push(extId)
      }
    }

    if (candidates.length === 0) return []
    const outcome = await this.loadToolsets(candidates, text)
    return outcome.loaded.map((item) => item.id)
  }

  private toAgentTool(descriptor: LazyMcpToolDescriptor): RuntimeAgentTool {
    const cached = this.agentToolCache.get(descriptor.name)
    if (cached && cached.description === descriptor.description) {
      return cached
    }
    const schema =
      descriptor.inputSchema && typeof descriptor.inputSchema === 'object'
        ? descriptor.inputSchema
        : { type: 'object', properties: {} }

    const tool: RuntimeAgentTool = {
      name: descriptor.name,
      label: descriptor.title || descriptor.name,
      description: descriptor.description || descriptor.title || descriptor.name,
      parameters: schema,
      prepareArguments: (raw) => prepareLooseToolArguments(raw),
      execute: async (
        _toolCallId,
        params: Record<string, unknown>,
        signal
      ): Promise<RuntimeToolResult> => {
        this.touchTool(descriptor.name)
        const baseCtx = this.getRequestContext()
        const outcome = await this.backend.callMcpTool(
          descriptor.name,
          params ?? {},
          signal ? { ...baseCtx, signal } : baseCtx
        )
        const isError = Boolean(outcome.error)
        return {
          content: serializeToolOutcomeContent(outcome),
          details: isError
            ? { error: outcome.error }
            : ((outcome.result as Record<string, unknown>) ?? null),
          isError
        }
      }
    }
    this.agentToolCache.set(descriptor.name, tool)
    return tool
  }

  /**
   * 计算当前模式（Craft / Plan / Ask）下实际可见的完整激活工具数组（原生工具 + studio_core + 已挂载懒加载工具），
   * 并保证任何情况下数组长度 <= `maxActiveTools`（默认 96 < 128）。
   */
  buildActiveTools(): RuntimeAgentTool[] {
    const view = this.getAccessView()
    if (view.mode === 'ask') {
      return []
    }

    const nativeTools = this.nativeToolsProvider()
    const result: RuntimeAgentTool[] = [...nativeTools]
    const seen = new Set<string>(nativeTools.map((t) => t.name))

    // 1) 常驻 studio_core 工具（按 Craft / Plan 当前权限过滤）
    const allStudioAndBlender = this.backend.listStudioAndBlenderTools()
    for (const descriptor of allStudioAndBlender) {
      if (!STUDIO_CORE_SET.has(descriptor.name)) continue
      if (seen.has(descriptor.name)) continue
      if (!isToolVisible(descriptor.access, view)) continue
      if (result.length >= this.maxActiveTools) break
      seen.add(descriptor.name)
      result.push(this.toAgentTool(descriptor))
    }

    // 2) 按最近使用顺序（最新优先）装入已挂载懒加载工具包，超出预算的尾部自动截断
    const recordsDesc = Array.from(this.mounted.values()).sort(
      (a, b) => b.lastUsedSeq - a.lastUsedSeq
    )
    for (const record of recordsDesc) {
      for (const descriptor of record.tools) {
        if (seen.has(descriptor.name)) continue
        if (!isToolVisible(descriptor.access, view)) continue
        if (result.length >= this.maxActiveTools) break
        seen.add(descriptor.name)
        result.push(this.toAgentTool(descriptor))
      }
    }

    return result
  }

  /**
   * 当挂载新工具包后总工具数超过 `maxActiveTools` 时，按 LRU 顺序淘汰最久未使用的非本轮工具包；
   * 若本轮一次性请求的包自身就超过上限，再裁剪单包尾部工具，确保恒 <= `maxActiveTools`。
   */
  private enforceActiveToolCeiling(protectedIds: ReadonlySet<string>): string[] {
    const evicted: string[] = []
    const countTotalCandidateTools = (): number => {
      const names = new Set<string>(this.nativeToolsProvider().map((t) => t.name))
      for (const d of this.backend.listStudioAndBlenderTools()) {
        if (STUDIO_CORE_SET.has(d.name)) names.add(d.name)
      }
      for (const rec of this.mounted.values()) {
        for (const d of rec.tools) names.add(d.name)
      }
      return names.size
    }

    while (countTotalCandidateTools() > this.maxActiveTools && this.mounted.size > 0) {
      const candidates = Array.from(this.mounted.values()).sort(
        (a, b) => a.lastUsedSeq - b.lastUsedSeq
      )
      const victim = candidates.find((c) => !protectedIds.has(c.id)) ?? candidates[0]
      if (!victim) break

      // 若只剩受保护的刚加载包且仍超限，则裁剪该包尾部工具而不是整包删除
      if (protectedIds.has(victim.id) && this.mounted.size === 1) {
        const overflow = countTotalCandidateTools() - this.maxActiveTools
        if (overflow > 0 && victim.tools.length > overflow) {
          victim.tools = victim.tools.slice(0, victim.tools.length - overflow)
          break
        }
      }

      this.mounted.delete(victim.id)
      evicted.push(victim.id)
    }

    return evicted
  }

  /**
   * 创建供 Pi Agent 直接调用的 `load_toolset` 原生元工具。
   */
  createLoadToolsetTool(): RuntimeAgentTool {
    return {
      name: 'load_toolset',
      label: '加载按需工具包 (Load Toolset)',
      description:
        'On-demand lazy loader for specialized Studio, Blender, and external MCP toolsets. Call this tool BEFORE using any non-core domain tool (e.g. project_assets, video_timeline_audio, director_3d_blender, game_production, tutorial_recording, skills_web_vision, or ext:<serverId>). Loaded tools become immediately callable on your very next turn.',
      parameters: {
        type: 'object',
        properties: {
          toolsets: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Toolset IDs to mount (e.g. ["director_3d_blender"], ["video_timeline_audio"], ["ext:rea"]). Pass [] with listOnly=true to inspect all available toolsets.'
          },
          query: {
            type: 'string',
            description:
              'Optional keyword filter when loading large external MCP servers (e.g. "decompile apk android" or "macho symbols" for ext:rea) so the most relevant tools are mounted within the 96-tool ceiling.'
          },
          listOnly: {
            type: 'boolean',
            description:
              'If true, only list available toolsets and their load status without changing mounted tools.'
          }
        },
        additionalProperties: false
      },
      prepareArguments: (raw) => prepareLooseToolArguments(raw),
      execute: async (_toolCallId, params: Record<string, unknown>) => {
        const rawList = Array.isArray(params?.toolsets)
          ? params.toolsets.filter((x): x is string => typeof x === 'string')
          : typeof params?.toolset === 'string'
            ? [params.toolset]
            : []
        const query = typeof params?.query === 'string' ? params.query : ''
        const listOnly = Boolean(params?.listOnly) || rawList.length === 0

        if (listOnly) {
          const directory = this.getDirectorySummaries()
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  ok: true,
                  activeToolCount: this.buildActiveTools().length,
                  maxActiveTools: this.maxActiveTools,
                  availableToolsets: directory
                })
              }
            ],
            details: { availableToolsets: directory }
          }
        }

        const outcome = await this.loadToolsets(rawList, query)
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ok: outcome.unknownToolsets.length === 0,
                ...outcome,
                note:
                  this.getAccessView().mode === 'plan' && !this.getAccessView().confirmed
                    ? 'Plan 模式下已登记工具包；当前未确认计划前仅暴露只读工具，用户通过 ask_user 确认计划后写/生成工具将自动解锁。'
                    : '工具包已挂载，下一轮可直接调用 mountedTools 中的任意工具。'
              })
            }
          ],
          details: outcome
        }
      }
    }
  }
}
