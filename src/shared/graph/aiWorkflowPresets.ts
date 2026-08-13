import type { GraphPlan } from './graphPlan'
import {
  EPISODE_AGENT_BEATBOARD,
  EPISODE_AGENT_BREAKDOWN,
  EPISODE_AGENT_MOTION,
  EPISODE_AGENT_MOTION_9,
  EPISODE_AGENT_REVIEW_BEATBOARD,
  EPISODE_AGENT_REVIEW_BREAKDOWN,
  EPISODE_AGENT_REVIEW_MOTION,
  EPISODE_AGENT_REVIEW_MOTION_9,
  EPISODE_AGENT_REVIEW_SEQUENCE,
  EPISODE_AGENT_SEQUENCE
} from './episodeAgentPrompts'

/** 剧集 Agent 流水线：状态作用域键（集编号），生成后可改 */
const EPISODE_SCOPE_KEY = 'ep01'

/** 短剧分镜（Agent 流水线）：剧本 → 节拍拆解 → 9宫格 → 9 锚点图 → 4宫格(36) → 动态提示词(36) → 36 视频，4 级导演审核；grid9 为 9宫格直出 9 条视频 */
function buildEpisodePipelinePlan(
  variant: 'grid4' | 'grid9' = 'grid4'
): GraphPlan {
  const nodes: GraphPlan['nodes'] = []
  const edges: GraphPlan['edges'] = []
  const add = (node: GraphPlan['nodes'][number]): void => {
    nodes.push(node)
  }
  const link = (
    from: string,
    to: string,
    ports?: { fromPort?: string; toPort?: string }
  ): void => {
    edges.push({ from, to, ...ports })
  }
  const scope = { episodeScopeKey: EPISODE_SCOPE_KEY }

  add({
    key: 'script',
    typeId: 'play.script',
    title: '剧本',
    params: { text: '（在此填写单集剧本，或用「短剧创作框架」先生成）' }
  })
  link('script', 'breakdown')

  add({
    key: 'breakdown',
    typeId: 'prompt.optimize',
    title: '分镜师·节拍拆解表',
    params: {
      ...scope,
      episodeStep: 'breakdown',
      generateSystemPrompt: EPISODE_AGENT_BREAKDOWN.systemPromptZh,
      generateInstruction: EPISODE_AGENT_BREAKDOWN.instructionZh
    }
  })
  add({
    key: 'review1',
    typeId: 'prompt.optimize',
    title: '导演审核·节拍拆解表',
    params: {
      ...scope,
      episodeReviewTarget: 'breakdown',
      generateSystemPrompt: EPISODE_AGENT_REVIEW_BREAKDOWN.systemPromptZh,
      generateInstruction: EPISODE_AGENT_REVIEW_BREAKDOWN.instructionZh
    }
  })
  link('breakdown', 'review1', { fromPort: 'out', toPort: 'in' })
  link('breakdown', 'beatboard', { fromPort: 'out', toPort: 'in' })

  add({
    key: 'beatboard',
    typeId: 'prompt.optimize',
    title: '分镜师·9宫格分镜表',
    params: {
      ...scope,
      episodeStep: 'beatboard',
      generateSystemPrompt: EPISODE_AGENT_BEATBOARD.systemPromptZh,
      generateInstruction: EPISODE_AGENT_BEATBOARD.instructionZh
    }
  })
  add({
    key: 'review2',
    typeId: 'prompt.optimize',
    title: '导演审核·9宫格分镜表',
    params: {
      ...scope,
      episodeReviewTarget: 'beatboard',
      generateSystemPrompt: EPISODE_AGENT_REVIEW_BEATBOARD.systemPromptZh,
      generateInstruction: EPISODE_AGENT_REVIEW_BEATBOARD.instructionZh
    }
  })
  link('beatboard', 'review2', { fromPort: 'out', toPort: 'in' })

  // 9宫格拼图画布：一个生成节点生成 3×3 九宫格拼图，再逐格本地提取
  add({
    key: 'img9grid',
    typeId: 'asset.image',
    title: '9宫格拼图·锚点画布',
    params: {
        ...scope,
        episodeStep: 'beatboard',
        generateInstruction: `基于上游 9宫格分镜表生成一张 3×3 九宫格拼图画布：9 格按表内顺序依次对应 9 个核心锚点，人物服饰、主光方向、场景严格按表内描述保持绝对一致；每格独立成幅、无缝拼接，格与格之间不要边框、分隔线或白边；每格内容必须严格铺满自己的格子区域，格子边界即画面边界，不得内缩、留边距或留白；整张画布严格保持生成设置中的宽高比，无文字水印。`
    }
  })
  link('beatboard', 'img9grid', { fromPort: 'out', toPort: 'in-text' })
  for (let i = 1; i <= 9; i++) {
    const extractKey = `gridExtract${i}`
    const row = Math.floor((i - 1) / 3) + 1
    const col = ((i - 1) % 3) + 1
    add({
      key: extractKey,
      typeId: 'image.gridSplit',
      title: `宫格提取·格${i}`,
      params: {
        imageGridSplit: {
          rows: 3,
          cols: 3,
          selected: [`${row}-${col}`]
        }
      }
    })
    link('img9grid', extractKey, { fromPort: 'out', toPort: 'in' })
  }

  if (variant === 'grid9') {
    // 9宫格直出：动画师为 9 个宫格各拆解 1 条动态提示词，再逐格生成视频
    add({
      key: 'motion',
      typeId: 'prompt.optimize',
      title: '动画师·9宫格动态提示词表',
      params: {
        ...scope,
        episodeStep: 'motion',
        generateSystemPrompt: EPISODE_AGENT_MOTION_9.systemPromptZh,
        generateInstruction: EPISODE_AGENT_MOTION_9.instructionZh
      }
    })
    link('script', 'motion', { fromPort: 'out', toPort: 'in' })
    link('beatboard', 'motion', { fromPort: 'out', toPort: 'in' })
    add({
      key: 'review4',
      typeId: 'prompt.optimize',
      title: '导演审核·9宫格动态提示词表',
      params: {
        ...scope,
        episodeReviewTarget: 'motion',
        episodeReviewVariant: '9',
        generateSystemPrompt: EPISODE_AGENT_REVIEW_MOTION_9.systemPromptZh,
        generateInstruction: EPISODE_AGENT_REVIEW_MOTION_9.instructionZh
      }
    })
    link('motion', 'review4', { fromPort: 'out', toPort: 'in' })

    for (let g = 1; g <= 9; g++) {
      const cellKey = `cell${g}-1`
      const videoKey = `video${g}-1`
      add({
        key: cellKey,
        typeId: 'episode.cellSelect',
        title: `动态格选择·格${g}-1`,
        params: { cellGroupIndex: g, cellIndex: 1 }
      })
      link('motion', cellKey)
      add({
        key: videoKey,
        typeId: 'asset.video',
        title: `动态视频·格${g}-1`,
        params: {
          generateInstruction: `基于参考首帧图与上游动态提示词生成 Seedance 2.5 图生视频：保留参考图中人物身份、服装、发型、场景、主光方向与构图基调，严格按动态提示词中的时间轴、镜头运动、主体动作、完整对白与环境音执行。`,
          generateDuration: 15
        }
      })
      link(`gridExtract${g}`, videoKey, { fromPort: 'out', toPort: 'in-image' })
      link(cellKey, videoKey, { fromPort: 'out', toPort: 'in-text' })
    }

    add({
      key: 'note',
      typeId: 'note.text',
      title: '流水线说明',
      params: {
        text: `流程：剧本 → 节拍拆解表 → 9宫格分镜表 → 1 张 9宫格拼图 → 宫格提取 9 格锚点图 → 动画师·9宫格动态提示词表(9条，每条覆盖上一关键帧到本关键帧的完整剧情与对白，时长 3~15 秒) → 9 条动态视频（每条直接用对应 9宫格锚点图作首帧）。

导演审核：review1（节拍）、review2（9宫格）、review4（9宫格动态提示词）输出 ## 结论: PASS / FAIL；FAIL 原因会自动写入 agent-state.json，重跑对应分镜师/动画师节点时自动附加原因。

视频产出：单条按需 = 只运行某个 video 节点；一键全跑 = 批量运行全部 9 条 video 节点。命名规则：集-场-宫格。`
      }
    })
  } else {
    add({
      key: 'sequence',
      typeId: 'prompt.optimize',
      title: '分镜师·4宫格动态分镜表',
      params: {
        ...scope,
        episodeStep: 'sequence',
        generateSystemPrompt: EPISODE_AGENT_SEQUENCE.systemPromptZh,
        generateInstruction: EPISODE_AGENT_SEQUENCE.instructionZh
      }
    })
    link('beatboard', 'sequence', { fromPort: 'out', toPort: 'in' })
    add({
      key: 'review3',
      typeId: 'prompt.optimize',
      title: '导演审核·4宫格动态分镜表',
      params: {
        ...scope,
        episodeReviewTarget: 'sequence',
        generateSystemPrompt: EPISODE_AGENT_REVIEW_SEQUENCE.systemPromptZh,
        generateInstruction: EPISODE_AGENT_REVIEW_SEQUENCE.instructionZh
      }
    })
    link('sequence', 'review3', { fromPort: 'out', toPort: 'in' })
    link('sequence', 'motion', { fromPort: 'out', toPort: 'in' })

    add({
      key: 'motion',
      typeId: 'prompt.optimize',
      title: '动画师·动态提示词表',
      params: {
        ...scope,
        episodeStep: 'motion',
        generateSystemPrompt: EPISODE_AGENT_MOTION.systemPromptZh,
        generateInstruction: EPISODE_AGENT_MOTION.instructionZh
      }
    })
    add({
      key: 'review4',
      typeId: 'prompt.optimize',
      title: '导演审核·动态提示词表',
      params: {
        ...scope,
        episodeReviewTarget: 'motion',
        generateSystemPrompt: EPISODE_AGENT_REVIEW_MOTION.systemPromptZh,
        generateInstruction: EPISODE_AGENT_REVIEW_MOTION.instructionZh
      }
    })
    link('motion', 'review4', { fromPort: 'out', toPort: 'in' })

    // 9 组 4宫格拼图（2×2）：每组用 9宫格提取的锚点图作参考生成 4宫格拼图，
    // 再本地提取 4 格，分别作为该组 4 个动态视频的参考图
    for (let g = 1; g <= 9; g++) {
      const img4Key = `img4grid${g}`
      add({
        key: img4Key,
        typeId: 'asset.image',
        title: `4宫格拼图·组${g}`,
        params: {
          ...scope,
          episodeStep: 'sequence',
          generateInstruction: `基于上游 4宫格动态分镜表生成第 ${g} 组的 2×2 四宫格拼图画布：左上定场、右上引入、左下冲突、右下收尾，人物服饰、主光方向、场景与参考首帧严格一致；每格独立成幅、无缝拼接，格与格之间不要边框、分隔线或白边；每格内容必须严格铺满自己的格子区域，格子边界即画面边界，不得内缩、留边距或留白；整张画布严格保持生成设置中的宽高比，无文字水印。`
        }
      })
      link('sequence', img4Key, { fromPort: 'out', toPort: 'in-text' })
      link(`gridExtract${g}`, img4Key, { fromPort: 'out', toPort: 'in-image' })
      const CELL_KEYS = ['1-1', '1-2', '2-1', '2-2'] as const
      for (let c = 1; c <= 4; c++) {
        const extract4Key = `gridExtract4-${g}-${c}`
        add({
          key: extract4Key,
          typeId: 'image.gridSplit',
          title: `宫格提取·组${g}-格${c}`,
          params: {
            imageGridSplit: {
              rows: 2,
              cols: 2,
              selected: [CELL_KEYS[c - 1]]
            }
          }
        })
        link(img4Key, extract4Key, { fromPort: 'out', toPort: 'in' })
      }
    }

    // 36 个动态格选择 + 36 条动态视频（父宫格锚点图作首帧）
    for (let g = 1; g <= 9; g++) {
      for (let c = 1; c <= 4; c++) {
        const cellKey = `cell${g}-${c}`
        const videoKey = `video${g}-${c}`
        add({
          key: cellKey,
          typeId: 'episode.cellSelect',
          title: `动态格选择·格${g}-${c}`,
          params: { cellGroupIndex: g, cellIndex: c }
        })
        link('motion', cellKey)
        add({
          key: videoKey,
          typeId: 'asset.video',
          title: `动态视频·格${g}-${c}`,
          params: {
            generateInstruction: `基于上游参考图与该动态格的图生视频指令生成 格${g}-${c} 的动态视频，参考图只提供风格与内容参考，严格遵循指令中的镜头运动、主体动作、环境交互与时长。`,
            generateDuration: 4
          }
        })
        link(`gridExtract4-${g}-${c}`, videoKey, { fromPort: 'out', toPort: 'in-image' })
        link(cellKey, videoKey, { fromPort: 'out', toPort: 'in-text' })
      }
    }

    add({
      key: 'note',
      typeId: 'note.text',
      title: '流水线说明',
      params: {
        text: `流程：剧本 → 节拍拆解表 → 9宫格分镜表 → 1 张 9宫格拼图 → 宫格提取 9 格锚点图 → 4宫格动态分镜表(9×4=36) → 每组 1 张 2×2 4宫格拼图（参考第 g 格锚点图）→ 宫格提取 36 格 → 动态提示词表(36) → 36 条动态视频（参考图用对应 4宫格提取图）。

导演审核：review1~review4 输出 ## 结论: PASS / FAIL；FAIL 原因会自动写入 agent-state.json，重跑对应分镜师/动画师节点时自动附加原因。

视频产出：单条按需 = 只运行某个 video 节点；一键全跑 = 批量运行全部 video 节点。命名规则：集-场-宫格-动态格。`
      }
    })
  }

  return {
    title: variant === 'grid9' ? '短剧分镜（9宫格直出）' : '短剧分镜（Agent 流水线）',
    nodes,
    edges
  }
}

/** 一键工作流预设 id（文案在 i18n `aiWorkflow.presets.<id>.*`） */
export const AI_WORKFLOW_PRESET_IDS = [
  'gameUaVideo',
  'characterSheet',
  'storyboardVideo',
  'productAd',
  'gameUi',
  'shortDrama',
  'shortDrama9',
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
  gameUi: {
    title: '游戏UI界面',
    nodes: [
      {
        key: 'gameSystem',
        typeId: 'asset.gameSystem',
        title: '策划案生成',
        params: { text: '（在此填写游戏系统需求，如：背包系统、任务系统、公会系统…）' }
      },
      {
        key: 'uiSplit',
        typeId: 'ui.split',
        title: 'UI界面拆分'
      },
      {
        key: 'uiGen',
        typeId: 'ui.gen',
        title: 'UI界面生成'
      },
      {
        key: 'note',
        typeId: 'note.text',
        title: '使用说明',
        params: {
          text: '使用流程：运行「策划案生成」产出系统策划案 → 运行「UI界面拆分」拆出各界面提示词 → 双击「UI界面生成」进入内图逐屏出图 → 回外层点 Cook 汇集全部界面图。界面风格由全局风格参考图统一控制（风格库 → UI 风格）。'
        }
      }
    ],
    edges: [
      { from: 'gameSystem', to: 'uiSplit' },
      { from: 'uiSplit', to: 'uiGen' }
    ]
  },
  shortDrama: buildEpisodePipelinePlan('grid4'),
  shortDrama9: buildEpisodePipelinePlan('grid9')
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
