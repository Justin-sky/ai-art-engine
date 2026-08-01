import type { GraphPlan } from './graphPlan'

/** 一键工作流预设 id（文案在 i18n `aiWorkflow.presets.<id>.*`） */
export const AI_WORKFLOW_PRESET_IDS = [
  'gameUaVideo',
  'characterSheet',
  'storyboardVideo',
  'productAd',
  'shortDrama',
  'custom'
] as const

export type AiWorkflowPresetId = (typeof AI_WORKFLOW_PRESET_IDS)[number]

/** 固化拓扑：选预设即可预览/落盘；AI 生成时作为骨架约束 */
const PRESET_PLANS: Record<Exclude<AiWorkflowPresetId, 'custom'>, GraphPlan> = {
  gameUaVideo: {
    title: '游戏买量短视频',
    nodes: [
      {
        key: 'script',
        typeId: 'play.script',
        title: '卖点与旁白',
        params: { text: '（在此填写游戏卖点、钩子与旁白文案）' }
      },
      {
        key: 'keyart',
        typeId: 'asset.image',
        title: '关键分镜图',
        params: { generateInstruction: '竖屏游戏买量关键帧，角色清晰，强视觉冲击' }
      },
      {
        key: 'video',
        typeId: 'asset.video',
        title: '买量视频',
        params: {
          generateInstruction: '15 秒左右竖屏广告节奏，承接关键帧画面',
          generateDuration: 15,
          generateAspectRatio: '9:16'
        }
      },
      {
        key: 'note',
        typeId: 'note.text',
        title: '剪辑说明',
        params: { text: '成片剪辑顺序与时长备注' }
      }
    ],
    edges: [
      { from: 'script', to: 'keyart' },
      { from: 'keyart', to: 'video' }
    ]
  },
  characterSheet: {
    title: '角色设定',
    nodes: [
      {
        key: 'bio',
        typeId: 'play.script',
        title: '人设描述',
        params: { text: '（角色姓名、性格、外观、服饰与画风约束）' }
      },
      {
        key: 'front',
        typeId: 'asset.image',
        title: '正面立绘',
        params: { generateInstruction: '角色正面全身立绘，干净背景' }
      },
      {
        key: 'side',
        typeId: 'asset.image',
        title: '侧面立绘',
        params: { generateInstruction: '同一角色侧面全身立绘，画风与正面一致' }
      },
      {
        key: 'expr',
        typeId: 'asset.image',
        title: '表情变体',
        params: { generateInstruction: '同一角色半身表情变体，三到四格' }
      },
      {
        key: 'note',
        typeId: 'note.text',
        title: '设定备注',
        params: { text: '可在此记录禁忌色、道具与参考链接' }
      }
    ],
    edges: [
      { from: 'bio', to: 'front' },
      { from: 'bio', to: 'side' },
      { from: 'bio', to: 'expr' }
    ]
  },
  storyboardVideo: {
    title: '分镜出片',
    nodes: [
      {
        key: 'shots',
        typeId: 'play.script',
        title: '镜头列表',
        params: { text: '（按镜头列出画面说明与对白）' }
      },
      {
        key: 'board1',
        typeId: 'asset.image',
        title: '分镜 1',
        params: { generateInstruction: '镜头 1 分镜图' }
      },
      {
        key: 'board2',
        typeId: 'asset.image',
        title: '分镜 2',
        params: { generateInstruction: '镜头 2 分镜图' }
      },
      {
        key: 'board3',
        typeId: 'asset.image',
        title: '分镜 3',
        params: { generateInstruction: '镜头 3 分镜图' }
      },
      {
        key: 'clip',
        typeId: 'asset.video',
        title: '高潮镜头视频',
        params: { generateInstruction: '基于关键分镜生成短视频', generateDuration: 5 }
      },
      {
        key: 'note',
        typeId: 'note.text',
        title: '剪辑顺序',
        params: { text: '建议剪辑顺序：分镜1 → 分镜2 → 分镜3 → 高潮视频' }
      }
    ],
    edges: [
      { from: 'shots', to: 'board1' },
      { from: 'shots', to: 'board2' },
      { from: 'shots', to: 'board3' },
      { from: 'board2', to: 'clip' }
    ]
  },
  productAd: {
    title: '产品广告',
    nodes: [
      {
        key: 'copy',
        typeId: 'play.script',
        title: '卖点文案',
        params: { text: '（产品名、核心卖点、CTA）' }
      },
      {
        key: 'hero',
        typeId: 'asset.image',
        title: '产品主视觉',
        params: { generateInstruction: '产品英雄图，突出质感与卖点' }
      },
      {
        key: 'scene',
        typeId: 'asset.image',
        title: '使用场景图',
        params: { generateInstruction: '产品真实使用场景' }
      },
      {
        key: 'video',
        typeId: 'asset.video',
        title: '广告短视频',
        params: {
          generateInstruction: '产品特写与使用场景结合的短广告',
          generateDuration: 10
        }
      }
    ],
    edges: [
      { from: 'copy', to: 'hero' },
      { from: 'copy', to: 'scene' },
      { from: 'hero', to: 'video' }
    ]
  },
  shortDrama: {
    title: '短剧分镜',
    nodes: [
      {
        key: 's1',
        typeId: 'play.script',
        title: '场次 1 对白',
        params: { text: '（场次1：场景、人物、对白、镜头）' }
      },
      {
        key: 'b1',
        typeId: 'asset.image',
        title: '场次 1 分镜',
        params: { generateInstruction: '短剧场次1关键分镜' }
      },
      {
        key: 's2',
        typeId: 'play.script',
        title: '场次 2 对白',
        params: { text: '（场次2：场景、人物、对白、镜头）' }
      },
      {
        key: 'b2',
        typeId: 'asset.image',
        title: '场次 2 分镜',
        params: { generateInstruction: '短剧场次2关键分镜' }
      },
      {
        key: 'climax',
        typeId: 'asset.video',
        title: '高潮场视频',
        params: { generateInstruction: '高潮场次动态镜头', generateDuration: 8 }
      },
      {
        key: 'note',
        typeId: 'note.text',
        title: '场次备注',
        params: { text: '按场次从左到右排布；高潮接场次2分镜' }
      }
    ],
    edges: [
      { from: 's1', to: 'b1' },
      { from: 's2', to: 'b2' },
      { from: 'b2', to: 'climax' }
    ]
  }
}

export function hasAiWorkflowPresetPlan(id: string): id is Exclude<AiWorkflowPresetId, 'custom'> {
  return id !== 'custom' && id in PRESET_PLANS
}

export function getAiWorkflowPresetPlan(id: AiWorkflowPresetId): GraphPlan | null {
  if (!hasAiWorkflowPresetPlan(id)) return null
  return cloneGraphPlan(PRESET_PLANS[id])
}

export function cloneGraphPlan(plan: GraphPlan): GraphPlan {
  return JSON.parse(JSON.stringify(plan)) as GraphPlan
}
