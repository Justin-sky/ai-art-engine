/**
 * MCP 与 Agent 工具调用的可读操作摘要提取器。
 *
 * 目标：当 AI 对话调用 MCP 工具（如 `graph_edit` 创建/删除/更新节点与连线、
 * `director_stage_edit` 操作 3D 导演台、`timeline_edit` 编辑时间线、`asset_create` / `asset_delete` 等）时，
 * 将每一次调用及其内部的全部原子操作转化为人类可读的步骤列表（`steps`）与摘要（`detail`），
 * 供对话流实时内嵌展示。
 */

export type McpStepKind = 'add' | 'delete' | 'connect' | 'update' | 'run' | 'select' | 'info'

/** 剥离 `mcp__studio__` / `mcp__blender__` / `blender.` 等命名空间前缀，提取裸工具名 */
export function stripMcpToolPrefix(rawName: string): string {
  const trimmed = (rawName || '').trim()
  if (!trimmed) return 'tool'
  const studioMatch = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(trimmed)
  if (studioMatch) {
    const ns = studioMatch[1]
    const bare = studioMatch[2]
    if (ns === 'studio') return bare
    if (ns === 'blender') return `blender.${bare}`
    return `${ns}.${bare}`
  }
  return trimmed
}

const TOOL_TITLE_ZH: Record<string, string> = {
  graph_edit: '画布节点与连线编辑',
  graph_read: '读取画布结构',
  graph_node_types: '查询可用节点类型',
  graph_icon_refine: '精修图标节点',
  director_stage_edit: '3D 导演台编辑',
  director_stage_read: '读取 3D 导演台状态',
  task_run: '运行画布节点',
  task_status: '查询节点运行状态',
  timeline_edit: '编辑成片时间线',
  timeline_read: '读取成片时间线',
  timeline_rough_cut: '时间线自动粗剪',
  timeline_export: '导出成片视频',
  timeline_preview: '抽帧预览时间线',
  semantic_timeline_read: '读取语义时间线',
  semantic_analyze_video: '视频语义分析',
  asset_create: '新建资产',
  asset_delete: '删除资产',
  asset_rename: '重命名资产',
  asset_move: '移动资产',
  asset_write_text: '写入文本资产',
  asset_read_file: '读取工程文件',
  asset_list: '查询资产列表',
  asset_import: '导入外部资产',
  asset_package_export: '导出资产包',
  asset_package_import: '导入资产包',
  asset_qc: '资产规范质检',
  asset_qc_fix: '资产规范自动修复',
  folder_create: '新建资产文件夹',
  folder_move: '移动资产文件夹',
  folder_list: '查询资产文件夹',
  project_open: '打开工程',
  project_create: '新建工程',
  project_list: '查询最近工程',
  project_memory_read: '读取工程记忆',
  project_memory_write: '写入工程记忆',
  project_memory_append: '追加工程记忆',
  voice_profile_list: '查询角色音色档案',
  voice_profile_upsert: '保存角色音色档案',
  voice_profile_delete: '删除角色音色档案',
  transcribe_audio: '音频语音转写',
  audio_separate: '人声与伴奏分离',
  render_svg: '渲染 SVG 动画',
  stage2d_spine_export: '导出 2D 骨骼动画',
  gameplay_prepare_project: '准备可玩 HTML 工程',
  gameplay_build: '构建可玩 HTML 产物',
  gameplay_job_status: '查询可玩 HTML 状态',
  extract_video_frames: '提取视频序列帧',
  grab_video_frames: '抓取视频画面帧',
  detect_video_keyframes: '检测视频关键帧',
  analyze_video_beats: '分析视频节奏点',
  skill_list: '查询已安装技能',
  skill_search: '搜索在线技能',
  skill_inspect_github: '预检 GitHub 技能',
  skill_install: '安装技能包',
  skill_uninstall: '卸载技能包',
  skill: '加载技能指令',
  decide: 'AI 创作决策分析',
  ask_user: '向用户提问确认',
  ask_user_question: '向用户提问确认',
  web_extract_article: '提取网页正文',
  web_search: '联网搜索',
  web_fetch: '读取网页',
  read: '读取文件',
  write: '写入文件',
  edit: '编辑文件',
  str_replace_editor: '编辑文件',
  glob: '搜索文件',
  grep: '检索代码内容',
  pwsh: '执行终端命令',
  bash: '执行终端命令',
  subagent: '派发子代理任务',
  subagent_fork: '分叉子代理任务',
  send_message: '向子代理发送指令',
  todo_write: '更新任务清单',
  present: '交付成果文件'
}

const TOOL_TITLE_EN: Record<string, string> = {
  graph_edit: 'Canvas Graph Edit',
  graph_read: 'Read Canvas Graph',
  graph_node_types: 'Query Node Types',
  graph_icon_refine: 'Refine Icon Node',
  director_stage_edit: '3D Director Stage Edit',
  director_stage_read: 'Read 3D Director Stage',
  task_run: 'Run Canvas Nodes',
  task_status: 'Check Task Status',
  timeline_edit: 'Edit Timeline',
  timeline_read: 'Read Timeline',
  timeline_rough_cut: 'Timeline Rough Cut',
  timeline_export: 'Export Timeline Video',
  timeline_preview: 'Preview Timeline Frames',
  asset_create: 'Create Asset',
  asset_delete: 'Delete Asset',
  asset_rename: 'Rename Asset',
  asset_move: 'Move Asset',
  asset_write_text: 'Write Text Asset',
  asset_read_file: 'Read Project File',
  asset_list: 'List Assets',
  asset_import: 'Import Assets',
  folder_create: 'Create Folder',
  folder_move: 'Move Folder',
  folder_list: 'List Folders',
  project_open: 'Open Project',
  project_create: 'Create Project',
  project_memory_write: 'Write Project Memory',
  project_memory_append: 'Append Project Memory',
  voice_profile_upsert: 'Save Voice Profile',
  voice_profile_delete: 'Delete Voice Profile',
  skill_list: 'List Skills',
  skill_search: 'Search Skills',
  skill_install: 'Install Skill',
  skill_uninstall: 'Uninstall Skill',
  skill: 'Load Skill'
}

/** 获取工具在对话流中的友好显示名称 */
export function formatMcpToolDisplayName(rawName: string, isEn = false): string {
  const bare = stripMcpToolPrefix(rawName)
  if (isEn) {
    if (TOOL_TITLE_EN[bare]) return TOOL_TITLE_EN[bare]
    if (bare.startsWith('blender.')) return `Blender · ${bare.slice('blender.'.length)}`
    return bare
  }
  if (TOOL_TITLE_ZH[bare]) return TOOL_TITLE_ZH[bare]
  if (bare.startsWith('blender.')) return `Blender 3D · ${bare.slice('blender.'.length)}`
  return bare
}

function parseJsonObject(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed.startsWith('{')) return null
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      return null
    }
  }
  return null
}

function str(obj: Record<string, unknown>, key: string): string {
  const val = obj[key]
  return typeof val === 'string' ? val.trim() : ''
}

function summarizeGraphEditOpFromArg(opObj: Record<string, unknown>): string | null {
  const op = str(opObj, 'op') || str(opObj, 'action')
  const nodeId = str(opObj, 'nodeId') || str(opObj, 'id')
  const title = str(opObj, 'title') || str(opObj, 'label')
  const typeId = str(opObj, 'typeId') || str(opObj, 'type')
  const titleTag = title ? `「${title}」` : ''
  const typeTag = typeId ? `（${typeId}）` : ''

  switch (op) {
    case 'node_upsert':
    case 'node_add':
    case 'add_node':
      return `新建节点 ${nodeId}${titleTag}${typeTag}`.trim()
    case 'node_update':
    case 'update_node':
    case 'update_data':
      return `更新节点 ${nodeId}${titleTag}`.trim()
    case 'node_delete':
    case 'delete_node':
      return `删除节点 ${nodeId}${titleTag}（含连线）`.trim()
    case 'edge_connect':
    case 'edge_add':
    case 'add_edge': {
      const from = str(opObj, 'fromNodeId') || str(opObj, 'from') || str(opObj, 'source')
      const to = str(opObj, 'toNodeId') || str(opObj, 'to') || str(opObj, 'target')
      if (!from && !to) return null
      return `连线 ${from} → ${to}`
    }
    case 'edge_delete':
    case 'delete_edge': {
      const from = str(opObj, 'fromNodeId') || str(opObj, 'from') || str(opObj, 'source')
      const to = str(opObj, 'toNodeId') || str(opObj, 'to') || str(opObj, 'target')
      if (!from && !to) return null
      return `删除连线 ${from} → ${to}`
    }
    case 'apply_preset': {
      const preset = str(opObj, 'preset')
      return `应用预设 ${preset} → 节点 ${nodeId}${titleTag}`.trim()
    }
    case 'node_select':
    case 'select_node':
      return `选中节点 ${nodeId}`.trim()
    case 'group_add':
    case 'add_group': {
      const groupId = str(opObj, 'groupId')
      return `新建分组 ${groupId}${titleTag}`.trim()
    }
    case 'group_update':
    case 'update_group': {
      const groupId = str(opObj, 'groupId')
      return `更新分组 ${groupId}${titleTag}`.trim()
    }
    case 'group_delete':
    case 'delete_group': {
      const groupId = str(opObj, 'groupId')
      return `删除分组 ${groupId}${titleTag}`.trim()
    }
    case 'auto_layout':
      return '自动布局'
    default:
      if (op && nodeId) return `${op} ${nodeId}${titleTag}`
      if (op) return op
      return null
  }
}

function summarizeDirectorStageOpFromArg(opObj: Record<string, unknown>): string | null {
  const op = str(opObj, 'op')
  const name = str(opObj, 'name') || str(opObj, 'objectId') || str(opObj, 'cameraId')
  const targetTag = name ? `「${name}」` : ''
  switch (op) {
    case 'object_add': {
      const kind = str(opObj, 'kind') || str(opObj, 'primitive')
      return `新建 3D 对象${targetTag}${kind ? `（${kind}）` : ''}`
    }
    case 'object_delete':
      return `删除 3D 对象${targetTag}`
    case 'object_duplicate':
      return `复制 3D 对象${targetTag}`
    case 'hide_object':
      return `隐藏 3D 对象${targetTag}`
    case 'show_object':
      return `显示 3D 对象${targetTag}`
    case 'lock_object':
      return `锁定 3D 对象${targetTag}`
    case 'unlock_object':
      return `解锁 3D 对象${targetTag}`
    case 'object_select':
      return `选中 3D 对象${targetTag}`
    case 'pose_update':
    case 'set_action':
    case 'switch_action':
    case 'play_clip':
    case 'sequence_actions': {
      const pose = str(opObj, 'posePreset') || str(opObj, 'clip') || str(opObj, 'animationClip')
      return `调整角色姿态/动作${targetTag}${pose ? ` → ${pose}` : ''}`
    }
    case 'object_update': {
      if (opObj.visible === false) return `隐藏 3D 对象${targetTag}`
      if (opObj.visible === true) return `显示 3D 对象${targetTag}`
      const newName = str(opObj, 'newName')
      if (newName) return `重命名 3D 对象${targetTag} → 「${newName}」`
      return `更新 3D 对象${targetTag}`
    }
    case 'camera_add':
      return `新建 3D 机位${targetTag}`
    case 'camera_delete':
      return `删除 3D 机位${targetTag}`
    case 'camera_update':
      return `调整 3D 机位${targetTag}`
    case 'lighting_preset':
      return `切换 3D 布光预设${str(opObj, 'presetId') ? `「${str(opObj, 'presetId')}」` : ''}`
    case 'environment_update':
      return '更新 3D 环境与天光'
    case 'viewport_update':
      return '切换 3D 视口显示模式'
    case 'ai_blocking':
      return `AI 场面调度${str(opObj, 'prompt') ? `：${str(opObj, 'prompt').slice(0, 36)}` : ''}`
    case 'cinemachine_pack':
      return `应用智能机位包${str(opObj, 'packId') ? `「${str(opObj, 'packId')}」` : ''}`
    case 'storyboard_previz':
      return '生成 3D 分镜白模预演'
    case 'capture_shot':
      return `抓拍 3D 导演台画面${targetTag}`
    case 'anim_control':
      return `动画控制：${str(opObj, 'action') || '更新'}`
    default:
      return op ? `3D 舞台操作：${op}${targetTag}` : null
  }
}

function summarizeTimelineEditOpFromArg(opObj: Record<string, unknown>): string | null {
  const op = str(opObj, 'op')
  switch (op) {
    case 'add': {
      const clips = Array.isArray(opObj.clips) ? opObj.clips : []
      if (clips.length === 1 && clips[0] && typeof clips[0] === 'object') {
        const c = clips[0] as Record<string, unknown>
        const title = str(c, 'title') || str(c, 'text') || str(c, 'assetId')
        const track = str(c, 'track')
        return `铺设时间线片段${title ? `「${title.slice(0, 24)}」` : ''}${track ? `（${track}轨）` : ''}`
      }
      return `铺设 ${clips.length} 枚时间线片段`
    }
    case 'update': {
      const clipId = str(opObj, 'clipId')
      return `更新时间线片段 ${clipId}`
    }
    case 'batchUpdate': {
      const track = str(opObj, 'track')
      return `批量更新时间线片段${track ? `（${track}轨）` : ''}`
    }
    case 'remove': {
      const clipIds = Array.isArray(opObj.clipIds)
        ? opObj.clipIds.filter((x): x is string => typeof x === 'string')
        : []
      return `删除时间线片段 ${clipIds.join(', ')}`.trim()
    }
    case 'applyTemplate':
      return `应用成片模板「${str(opObj, 'templateId')}」`
    case 'subtitles':
      return `生成配音同步字幕（${str(opObj, 'voiceClipId')}）`
    default:
      return op ? `时间线操作：${op}` : null
  }
}

/**
 * 从工具调用入参提取可读操作步骤列表（`start` 阶段与历史消息回退均使用）
 */
export function extractMcpToolStepsFromArgs(rawName: string, rawArgs: unknown): string[] {
  const bare = stripMcpToolPrefix(rawName)
  const args = parseJsonObject(rawArgs)
  if (!args) return []

  switch (bare) {
    case 'graph_edit': {
      const ops = Array.isArray(args.ops) ? args.ops : []
      const out: string[] = []
      for (const item of ops) {
        if (!item || typeof item !== 'object') continue
        const step = summarizeGraphEditOpFromArg(item as Record<string, unknown>)
        if (step) out.push(step)
      }
      return out
    }
    case 'director_stage_edit': {
      const ops = Array.isArray(args.ops) ? args.ops : []
      const out: string[] = []
      for (const item of ops) {
        if (!item || typeof item !== 'object') continue
        const step = summarizeDirectorStageOpFromArg(item as Record<string, unknown>)
        if (step) out.push(step)
      }
      return out
    }
    case 'timeline_edit': {
      const ops = Array.isArray(args.operations)
        ? args.operations
        : Array.isArray(args.ops)
          ? args.ops
          : []
      const out: string[] = []
      for (const item of ops) {
        if (!item || typeof item !== 'object') continue
        const step = summarizeTimelineEditOpFromArg(item as Record<string, unknown>)
        if (step) out.push(step)
      }
      return out
    }
    case 'task_run': {
      const nodeId = str(args, 'nodeId')
      const nodeIds = Array.isArray(args.nodeIds)
        ? args.nodeIds.filter((x): x is string => typeof x === 'string' && Boolean(x.trim()))
        : []
      const targets = nodeId ? [nodeId, ...nodeIds] : nodeIds
      if (targets.length) {
        return [`运行节点 ${targets.join('、')}`]
      }
      return ['运行画布流程']
    }
    case 'asset_create': {
      const name = str(args, 'name')
      const type = str(args, 'type')
      return [`新建资产${name ? `「${name}」` : ''}${type ? `（${type}）` : ''}`]
    }
    case 'asset_delete': {
      const id = str(args, 'assetId') || str(args, 'id')
      return [`删除资产 ${id}`.trim()]
    }
    case 'asset_rename': {
      const id = str(args, 'assetId')
      const name = str(args, 'name')
      return [`重命名资产 ${id}${name ? ` → 「${name}」` : ''}`.trim()]
    }
    case 'asset_move': {
      const id = str(args, 'assetId')
      const folderId = str(args, 'folderId')
      return [`移动资产 ${id} → ${folderId ? `文件夹 ${folderId}` : '根目录'}`.trim()]
    }
    case 'asset_write_text': {
      const id = str(args, 'assetId') || str(args, 'name')
      return [`写入文本资产 ${id}`.trim()]
    }
    case 'asset_import': {
      const paths = Array.isArray(args.filePaths) ? args.filePaths : []
      return paths.length ? [`导入 ${paths.length} 个外部文件到资产库`] : ['导入外部资产']
    }
    case 'folder_create': {
      const name = str(args, 'name')
      return [`新建文件夹${name ? `「${name}」` : ''}`]
    }
    case 'folder_move': {
      const id = str(args, 'folderId')
      const name = str(args, 'name')
      return [`更新文件夹 ${id}${name ? `「${name}」` : ''}`.trim()]
    }
    case 'voice_profile_upsert': {
      const name = str(args, 'name') || str(args, 'role') || str(args, 'id')
      return [`保存角色音色档案${name ? `「${name}」` : ''}`]
    }
    case 'voice_profile_delete': {
      const id = str(args, 'id')
      return [`删除角色音色档案 ${id}`.trim()]
    }
    case 'project_memory_write':
      return ['写入工程记忆文档']
    case 'project_memory_append': {
      const sec = str(args, 'section')
      return [`追加工程记忆${sec ? `（${sec}）` : ''}`]
    }
    case 'timeline_rough_cut':
      return ['基于配音节奏执行时间线粗剪']
    case 'timeline_export': {
      const file = str(args, 'defaultFileName') || str(args, 'targetPath')
      return [`导出成片视频${file ? `「${file}」` : ''}`]
    }
    case 'graph_icon_refine': {
      const nodeId = str(args, 'nodeId')
      return [`精修图标节点 ${nodeId}`.trim()]
    }
    case 'skill_install': {
      const url = str(args, 'url') || str(args, 'marketId') || str(args, 'name')
      return [`安装技能 ${url}`.trim()]
    }
    case 'skill_uninstall': {
      const name = str(args, 'name')
      return [`卸载技能 ${name}`.trim()]
    }
    default:
      return []
  }
}

/**
 * 从工具返回结果提取精确的操作步骤列表（优先取 `result.applied` 等服务端已解析节点名称的结果）
 */
export function extractMcpToolStepsFromResult(
  rawName: string,
  rawResult: unknown,
  rawArgs?: unknown
): string[] {
  const bare = stripMcpToolPrefix(rawName)
  const res = parseJsonObject(rawResult)
  const unwrapped =
    res && typeof res.result === 'object' && res.result !== null && !Array.isArray(res.result)
      ? (res.result as Record<string, unknown>)
      : res

  if (unwrapped) {
    if (Array.isArray(unwrapped.applied) && unwrapped.applied.length > 0) {
      const applied = unwrapped.applied
        .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
        .map((item) => item.trim())
      if (applied.length > 0) return applied
    }

    switch (bare) {
      case 'asset_create': {
        const asset = parseJsonObject(unwrapped.asset) ?? unwrapped
        const name = str(asset, 'name')
        const type = str(asset, 'type')
        const id = str(asset, 'id')
        if (name || id) {
          return [
            `新建资产 ${id ? `${id}` : ''}${name ? `「${name}」` : ''}${type ? `（${type}）` : ''}`.trim()
          ]
        }
        break
      }
      case 'asset_delete': {
        const deleted = parseJsonObject(unwrapped.deleted)
        const name = deleted ? str(deleted, 'name') : ''
        const id = (deleted ? str(deleted, 'id') : '') || str(unwrapped, 'assetId')
        if (name || id) {
          return [`删除资产 ${id}${name ? `「${name}」` : ''}`.trim()]
        }
        break
      }
      case 'asset_rename': {
        const asset = parseJsonObject(unwrapped.asset) ?? unwrapped
        const name = str(asset, 'name')
        const id = str(asset, 'id')
        if (name || id) {
          return [`重命名资产 ${id} → 「${name}」`.trim()]
        }
        break
      }
      case 'asset_move': {
        const asset = parseJsonObject(unwrapped.asset) ?? unwrapped
        const name = str(asset, 'name')
        const folderId = str(asset, 'folderId')
        if (name) {
          return [`移动资产「${name}」→ ${folderId ? `文件夹 ${folderId}` : '根目录'}`]
        }
        break
      }
      case 'folder_create': {
        const folder = parseJsonObject(unwrapped.folder) ?? unwrapped
        const name = str(folder, 'name')
        if (name) return [`新建文件夹「${name}」`]
        break
      }
      case 'timeline_edit': {
        const fromArgs = extractMcpToolStepsFromArgs(rawName, rawArgs)
        if (fromArgs.length > 0) return fromArgs
        if (typeof unwrapped.clipCount === 'number') {
          return [`时间线编辑完成（当前共 ${unwrapped.clipCount} 枚片段）`]
        }
        break
      }
      case 'task_run': {
        const fromArgs = extractMcpToolStepsFromArgs(rawName, rawArgs)
        const relPaths = Array.isArray(unwrapped.relativePaths)
          ? unwrapped.relativePaths.filter((x): x is string => typeof x === 'string')
          : []
        if (fromArgs.length > 0 && relPaths.length > 0) {
          return [...fromArgs, `产出 ${relPaths.length} 份结果文件`]
        }
        if (fromArgs.length > 0) return fromArgs
        break
      }
    }
  }

  return extractMcpToolStepsFromArgs(rawName, rawArgs)
}

/** 汇总单次工具调用的标题、单行摘要与步骤清单 */
export function summarizeMcpToolOperation(
  rawName: string,
  rawArgs: unknown,
  rawResult?: unknown,
  isEn = false
): { title: string; detail: string; steps: string[] } {
  const title = formatMcpToolDisplayName(rawName, isEn)
  const steps =
    rawResult !== undefined
      ? extractMcpToolStepsFromResult(rawName, rawResult, rawArgs)
      : extractMcpToolStepsFromArgs(rawName, rawArgs)
  const detail = steps.length > 0 ? steps.join(' · ') : ''
  return { title, detail, steps }
}

/** 对单条可读操作步骤分类，供 UI 渲染直观图标与着色标签 */
export function classifyMcpStepKind(step: string): McpStepKind {
  const s = (step || '').trim()
  if (/^(新建|添加|铺设|创建|导入|安装|\+)/.test(s)) return 'add'
  if (/^(删除|移除|清空|卸载|-)/.test(s)) return 'delete'
  if (/^(连线|连接|→)/.test(s)) return 'connect'
  if (/^(运行|执行|导出|生成|构建|粗剪|抓拍)/.test(s)) return 'run'
  if (/^(选中|聚焦)/.test(s)) return 'select'
  if (
    /^(更新|修改|重命名|移动|调整|切换|应用|设置|写入|追加|保存|精修|隐藏|显示|锁定|解锁)/.test(s)
  ) {
    return 'update'
  }
  return 'info'
}
