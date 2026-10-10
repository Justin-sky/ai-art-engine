/**
 * DirectorRuleEngine：JSON 规则 → 生产命令。
 * 首期编译目标是「可落地到 ffmpeg / ScriptTimeline 的数字运镜与调色」描述，
 * 不直接改文件；执行器按命令生成滤镜参数。
 */
import type {
  DirectorIntent,
  DirectorRule,
  DirectorRulePack,
  IntentTechnique,
  SemanticEvent,
  SemanticTimeline,
  StoryBeat
} from './types'

export type ProductionCommandKind =
  | 'camera.push_in'
  | 'camera.pan'
  | 'camera.zoom'
  | 'camera.static'
  | 'light.darken'
  | 'light.brighten'
  | 'audio.sfx'
  | 'text.emphasis'
  | 'grade.eq'
  | 'reshoot.l2'

export interface ProductionCommand {
  kind: ProductionCommandKind | string
  /** 绑定时间范围（秒） */
  start: number
  end: number
  params: Record<string, unknown>
  reason: string
  sourceIntentId?: string
  sourceRuleId?: string
}

export interface CompileOptions {
  rulePacks?: DirectorRulePack[]
  /** 额外意图（来自 applyIntent 编辑） */
  extraIntents?: DirectorIntent[]
}

function matchRule(
  rule: DirectorRule,
  event: SemanticEvent | undefined,
  beat: StoryBeat | undefined
): boolean {
  const w = rule.when
  if (w.eventLabel && event?.label !== w.eventLabel) return false
  if (w.beatType && beat?.type !== w.beatType) return false
  if (w.emotion && beat?.emotion.label !== w.emotion && event?.type !== 'emotion') return false
  // 至少命中一个条件
  return !!(w.eventLabel || w.beatType || w.emotion)
}

function techniqueToCommand(
  tech: IntentTechnique,
  start: number,
  end: number,
  reason: string,
  meta: { intentId?: string; ruleId?: string }
): ProductionCommand {
  const action = tech.action
  let kind: string
  if (tech.track === 'camera') {
    kind = action.startsWith('camera.') ? action : `camera.${action}`
  } else if (tech.track === 'audio') {
    kind = action.startsWith('audio.') ? action : `audio.${action}`
  } else if (tech.track === 'text') {
    kind = action.startsWith('text.') ? action : `text.${action}`
  } else if (tech.track === 'vfx' || action.includes('light') || action.includes('grade')) {
    kind = action.includes('.') ? action : `light.${action}`
  } else {
    kind = `${tech.track}.${action}`
  }
  // 需要真实运镜时标 L2
  if (tech.params?.requireReshoot === true) {
    kind = 'reshoot.l2'
  }
  return {
    kind,
    start,
    end,
    params: { ...(tech.params ?? {}) },
    reason,
    sourceIntentId: meta.intentId,
    sourceRuleId: meta.ruleId
  }
}

/** 规则包 + 文档内 intents → 生产命令列表（按时间排序） */
export function compileDirectorCommands(
  timeline: SemanticTimeline,
  options: CompileOptions = {}
): ProductionCommand[] {
  const commands: ProductionCommand[] = []
  const packs = options.rulePacks ?? []
  const intents = [...timeline.intents, ...(options.extraIntents ?? [])]

  // 1) 显式意图
  for (const intent of intents) {
    const event = timeline.events.find((e) => e.id === intent.trigger || e.label === intent.trigger)
    const beat = timeline.beats.find((b) => b.id === intent.trigger || b.type === intent.trigger)
    const start = event?.timeRange.start ?? beat?.timeRange.start ?? 0
    const end = event?.timeRange.end ?? beat?.timeRange.end ?? start + 1
    for (const tech of intent.techniques) {
      commands.push(techniqueToCommand(tech, start, end, intent.reason, { intentId: intent.id }))
    }
  }

  // 2) 规则包：对每个事件/节拍匹配
  for (const pack of packs) {
    for (const rule of pack.rules) {
      for (const event of timeline.events) {
        const beat = timeline.beats.find((b) => b.events.includes(event.id))
        if (!matchRule(rule, event, beat)) continue
        for (const tech of rule.then) {
          commands.push(
            techniqueToCommand(
              tech,
              event.timeRange.start,
              event.timeRange.end,
              rule.reason ?? pack.title,
              { ruleId: rule.id }
            )
          )
        }
      }
      // 仅 beatType / emotion 的规则
      if (rule.when.beatType || rule.when.emotion) {
        for (const beat of timeline.beats) {
          if (!matchRule(rule, undefined, beat)) continue
          // 已由事件侧覆盖过的跳过（避免双份）：仅当没有 eventLabel 时
          if (rule.when.eventLabel) continue
          for (const tech of rule.then) {
            commands.push(
              techniqueToCommand(
                tech,
                beat.timeRange.start,
                beat.timeRange.end,
                rule.reason ?? pack.title,
                { ruleId: rule.id }
              )
            )
          }
        }
      }
    }
  }

  commands.sort((a, b) => a.start - b.start || a.end - b.end)
  return commands
}

/**
 * 将 camera.push_in 等命令转为 ffmpeg 滤镜片段描述（供执行器拼 filtergraph）。
 * 返回 null 表示该命令需走生成模型（L2）。
 */
export function commandToFfmpegHint(cmd: ProductionCommand): {
  filter: string
  label: string
} | null {
  const dur = Math.max(0.01, cmd.end - cmd.start)
  switch (cmd.kind) {
    case 'camera.push_in':
    case 'camera.zoom': {
      // 数字推镜：从全画幅缓慢 crop 到中心
      const zoom = typeof cmd.params.zoom === 'number' ? cmd.params.zoom : 1.15
      return {
        label: 'push_in',
        filter: `zoompan=z='min(1+(${zoom}-1)*on/${Math.max(1, Math.round(dur * 30))},${zoom})':d=1:s=hd1080:fps=30`
      }
    }
    case 'light.darken':
      return {
        label: 'darken',
        filter: `eq=brightness=${typeof cmd.params.amount === 'number' ? -cmd.params.amount : -0.08}`
      }
    case 'light.brighten':
      return {
        label: 'brighten',
        filter: `eq=brightness=${typeof cmd.params.amount === 'number' ? cmd.params.amount : 0.06}`
      }
    case 'grade.eq': {
      const contrast = typeof cmd.params.contrast === 'number' ? cmd.params.contrast : 1.05
      const saturation = typeof cmd.params.saturation === 'number' ? cmd.params.saturation : 1.05
      return { label: 'grade', filter: `eq=contrast=${contrast}:saturation=${saturation}` }
    }
    case 'text.emphasis':
      return { label: 'text_emphasis', filter: '' } // 字幕样式由上层处理
    case 'audio.sfx':
    case 'audio.heartbeat':
      return { label: 'sfx', filter: '' }
    case 'reshoot.l2':
      return null
    default:
      if (cmd.kind.startsWith('camera.')) {
        return { label: cmd.kind, filter: '' }
      }
      return { label: cmd.kind, filter: '' }
  }
}

/** 内置基础规则包（核心；市场包可覆盖/扩展） */
export const BUILTIN_DIRECTOR_RULES: DirectorRulePack = {
  id: 'builtin.basic.v1',
  title: 'Basic Director Rules',
  rules: [
    {
      id: 'price-push',
      when: { eventLabel: 'price_announce' },
      then: [
        { track: 'camera', action: 'push_in', params: { zoom: 1.12 } },
        { track: 'audio', action: 'sfx', params: { id: 'ui_ding' } },
        { track: 'text', action: 'emphasis', params: { scale: 1.2 } }
      ],
      reason: '价格出现时推近并强调字幕' // cjk-ok
    },
    {
      id: 'hook-energy',
      when: { beatType: 'hook' },
      then: [{ track: 'camera', action: 'static', params: {} }],
      reason: '开场稳住画面' // cjk-ok
    },
    {
      id: 'offer-bright',
      when: { beatType: 'offer' },
      then: [{ track: 'vfx', action: 'brighten', params: { amount: 0.05 } }],
      reason: '报价段落略提亮' // cjk-ok
    }
  ]
}
