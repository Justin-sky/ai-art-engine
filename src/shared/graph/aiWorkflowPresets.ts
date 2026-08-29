import type { GraphPlan } from './graphPlan'
import { applyGraphSkill } from './graphSkills'
import { EPISODE_AGENT_STOCK_TITLES } from './episodeStageTitles'

/** 剧集 Agent 流水线：状态作用域键（集编号），生成后可改 */
const EPISODE_SCOPE_KEY = 'ep01'

/** 导演审核复合标题：前缀 + 目标阶段英文名（与旧中文「导演审核·X」同构） */
function directorReviewTitle(target: keyof typeof EPISODE_AGENT_STOCK_TITLES): string {
  return target === 'directorReview'
    ? EPISODE_AGENT_STOCK_TITLES.directorReview
    : `${EPISODE_AGENT_STOCK_TITLES.directorReview} · ${EPISODE_AGENT_STOCK_TITLES[target]}`
}

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
    title: EPISODE_AGENT_STOCK_TITLES.breakdown,
    params: {
      ...scope,
      episodeStep: 'breakdown',
      ...applyGraphSkill('episode.breakdown')
    }
  })
  add({
    key: 'review1',
    typeId: 'prompt.optimize',
    title: directorReviewTitle('breakdown'),
    params: {
      ...scope,
      episodeReviewTarget: 'breakdown',
      ...applyGraphSkill('episode.review.breakdown')
    }
  })
  link('script', 'review1', { fromPort: 'out', toPort: 'in' })
  link('breakdown', 'review1', { fromPort: 'out', toPort: 'in' })
  link('breakdown', 'beatboard', { fromPort: 'out', toPort: 'in' })

  add({
    key: 'beatboard',
    typeId: 'prompt.optimize',
    title: EPISODE_AGENT_STOCK_TITLES.beatboard,
    params: {
      ...scope,
      episodeStep: 'beatboard',
      ...applyGraphSkill('episode.beatboard')
    }
  })
  add({
    key: 'review2',
    typeId: 'prompt.optimize',
    title: directorReviewTitle('beatboard'),
    params: {
      ...scope,
      episodeReviewTarget: 'beatboard',
      ...applyGraphSkill('episode.review.beatboard')
    }
  })
  link('script', 'review2', { fromPort: 'out', toPort: 'in' })
  link('breakdown', 'review2', { fromPort: 'out', toPort: 'in' })
  link('beatboard', 'review2', { fromPort: 'out', toPort: 'in' })

  // 9宫格拼图画布：一个生成节点生成 3×3 九宫格拼图，再逐格本地提取
  add({
    key: 'img9grid',
    typeId: 'asset.image',
    title: '9宫格拼图·锚点画布',
    params: {
        ...scope,
        episodeStep: 'beatboard',
        ...applyGraphSkill('episode.image.grid9')
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
        // 稳定参数：流水线视图优先按此定位，避免按标题探测
        anchorCellIndex: i,
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
      title: EPISODE_AGENT_STOCK_TITLES.motion,
      params: {
        ...scope,
        episodeStep: 'motion',
        ...applyGraphSkill('episode.motion9')
      }
    })
    link('script', 'motion', { fromPort: 'out', toPort: 'in' })
    link('breakdown', 'motion', { fromPort: 'out', toPort: 'in' })
    link('beatboard', 'motion', { fromPort: 'out', toPort: 'in' })
    add({
      key: 'review4',
      typeId: 'prompt.optimize',
      title: directorReviewTitle('motion'),
      params: {
        ...scope,
        episodeReviewTarget: 'motion',
        episodeReviewVariant: '9',
        ...applyGraphSkill('episode.review.motion9')
      }
    })
    link('script', 'review4', { fromPort: 'out', toPort: 'in' })
    link('breakdown', 'review4', { fromPort: 'out', toPort: 'in' })
    link('beatboard', 'review4', { fromPort: 'out', toPort: 'in' })
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
          ...applyGraphSkill('episode.video.grid9'),
          // 稳定参数：流水线视图优先按此定位该条动态视频
          motionCellIndex: `${g}-1`,
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
      title: EPISODE_AGENT_STOCK_TITLES.sequence,
      params: {
        ...scope,
        episodeStep: 'sequence',
        ...applyGraphSkill('episode.sequence')
      }
    })
    link('beatboard', 'sequence', { fromPort: 'out', toPort: 'in' })
    // 4宫格动态分镜需要同时拿到节拍拆解：每组按“锚点 + 相邻普通节拍”合并展开，
    // 保证完整剧本内容都被使用，而不是只画关键帧单帧
    link('breakdown', 'sequence', { fromPort: 'out', toPort: 'in' })
    add({
      key: 'review3',
      typeId: 'prompt.optimize',
      title: directorReviewTitle('sequence'),
      params: {
        ...scope,
        episodeReviewTarget: 'sequence',
        ...applyGraphSkill('episode.review.sequence')
      }
    })
    link('script', 'review3', { fromPort: 'out', toPort: 'in' })
    link('breakdown', 'review3', { fromPort: 'out', toPort: 'in' })
    link('beatboard', 'review3', { fromPort: 'out', toPort: 'in' })
    link('sequence', 'review3', { fromPort: 'out', toPort: 'in' })
    link('sequence', 'motion', { fromPort: 'out', toPort: 'in' })

    add({
      key: 'motion',
      typeId: 'prompt.optimize',
      title: EPISODE_AGENT_STOCK_TITLES.motion,
      params: {
        ...scope,
        episodeStep: 'motion',
        ...applyGraphSkill('episode.motion')
      }
    })
    add({
      key: 'review4',
      typeId: 'prompt.optimize',
      title: directorReviewTitle('motion'),
      params: {
        ...scope,
        episodeReviewTarget: 'motion',
        ...applyGraphSkill('episode.review.motion')
      }
    })
    link('script', 'review4', { fromPort: 'out', toPort: 'in' })
    link('breakdown', 'review4', { fromPort: 'out', toPort: 'in' })
    link('beatboard', 'review4', { fromPort: 'out', toPort: 'in' })
    link('sequence', 'review4', { fromPort: 'out', toPort: 'in' })
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
          ...applyGraphSkill('episode.image.grid4', { vars: { group: g } })
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
            // 稳定参数：4 宫格按「组-格」定位，替代按标题探测
            gridCellIndex: `${g}-${c}`,
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
            ...applyGraphSkill('episode.video.grid4', { vars: { group: g, cell: c } }),
            // 稳定参数：流水线视图优先按此定位该条动态视频
            motionCellIndex: `${g}-${c}`,
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
  'ecomAdDeep',
  'game3dAsset',
  'comicPublish',
  'courseNarrate',
  'directorPreviz',
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
  ecomAdDeep: {
    title: '电商带货·变体与质检',
    nodes: [
      {
        key: 'copy',
        typeId: 'play.script',
        title: '卖点文案',
        params: { text: '（产品名、核心卖点、优惠信息与 CTA）' }
      },
      {
        key: 'hero',
        typeId: 'asset.image',
        title: '产品主视觉',
        params: { generateInstruction: '电商产品英雄图，突出质感与卖点，干净背景' }
      },
      {
        key: 'scene',
        typeId: 'asset.image',
        title: '使用场景图',
        params: { generateInstruction: '产品真实使用场景，突出人群与使用氛围' }
      },
      { key: 'adVariants', typeId: 'image.adVariants', title: '广告变体矩阵' },
      {
        key: 'rework',
        typeId: 'media.rework',
        title: '媒体返工',
        params: {
          generateInstruction:
            '保持产品形态与卖点信息一致，优化构图、清晰度与画面合规性'
        }
      },
      {
        key: 'review',
        typeId: 'media.review',
        title: '媒体质检',
        params: {
          generateInstruction:
            '检查电商广告图：卖点是否清晰、有无违禁夸大表述、构图是否完整、文字是否可读，输出通过或修改意见'
        }
      },
      { key: 'split', typeId: 'image.layerSplit', title: '图层分离' },
      {
        key: 'note',
        typeId: 'note.text',
        title: '使用说明',
        params: {
          text: '流程：运行「产品主视觉 / 使用场景图」→ 双击「广告变体矩阵」配置产品描述与变体维度，批量生成多版本 → 「媒体返工」按意见自动重试不达标结果 → 「媒体质检」输出最终审查结论。需要改详情页文字层时，把主视觉接入「图层分离」分层导出（PSD / PNG）。'
        }
      }
    ],
    edges: [
      { from: 'copy', to: 'hero' },
      { from: 'copy', to: 'scene' },
      { from: 'hero', to: 'adVariants' },
      { from: 'adVariants', to: 'rework', fromPort: 'out', toPort: 'in-image' },
      { from: 'rework', to: 'review', fromPort: 'out', toPort: 'in-image' },
      { from: 'hero', to: 'split', fromPort: 'out', toPort: 'in' }
    ]
  },
  game3dAsset: {
    title: '游戏 3D 资产预演',
    nodes: [
      {
        key: 'script',
        typeId: 'play.script',
        title: '资产设定',
        params: { text: '（描述角色 / 道具 / 载具的外观、材质与比例）' }
      },
      {
        key: 'modelMain',
        typeId: 'asset.model3d',
        title: '主角 3D 模型',
        params: { generateInstruction: '按设定生成主角 3D 模型，结构完整，材质干净' }
      },
      {
        key: 'modelProp',
        typeId: 'asset.model3d',
        title: '配套道具模型',
        params: { generateInstruction: '按设定生成配套道具 3D 模型，比例与主角一致' }
      },
      { key: 'motion', typeId: 'asset.motion', title: '导演台预演' },
      { key: 'select', typeId: 'image.select', title: '选站位图' },
      {
        key: 'video',
        typeId: 'asset.video',
        title: '资产展示视频',
        params: {
          generateInstruction: '基于站位图生成游戏资产展示视频，缓慢环绕运镜',
          generateDuration: 8,
          generateAspectRatio: '16:9'
        }
      },
      {
        key: 'note',
        typeId: 'note.text',
        title: '使用说明',
        params: {
          text: '流程：运行两个「3D 模型」节点生成 GLB → 连到「导演台预演」后双击进入舞台，模型自动实例化；在舞台里用基础几何体或「生成3D白模」补景、摆机位 → 截取站位图（out-shots）→ 经「选站位图」挑一张生成展示视频。配套道具模型可随时替换接入导演台。'
        }
      }
    ],
    edges: [
      { from: 'script', to: 'modelMain' },
      { from: 'script', to: 'modelProp' },
      { from: 'modelMain', to: 'motion', fromPort: 'out', toPort: 'in-model' },
      { from: 'motion', to: 'select', fromPort: 'out-shots', toPort: 'in' },
      { from: 'select', to: 'video', fromPort: 'out', toPort: 'in-image' }
    ]
  },
  comicPublish: {
    title: '漫画页出版',
    nodes: [
      {
        key: 'script',
        typeId: 'play.script',
        title: '漫画剧本',
        params: { text: '（按格写分镜：画面描述、台词、情绪与镜头）' }
      },
      {
        key: 'panel1',
        typeId: 'asset.image',
        title: '分镜图 1',
        params: { generateInstruction: '漫画第 1 格：按剧本绘制，统一画风与角色形象' }
      },
      {
        key: 'panel2',
        typeId: 'asset.image',
        title: '分镜图 2',
        params: { generateInstruction: '漫画第 2 格：承接第 1 格剧情，统一画风' }
      },
      {
        key: 'panel3',
        typeId: 'asset.image',
        title: '分镜图 3',
        params: { generateInstruction: '漫画第 3 格：收束本页剧情，统一画风' }
      },
      { key: 'page', typeId: 'comic.page', title: '漫画页' },
      {
        key: 'note',
        typeId: 'note.text',
        title: '使用说明',
        params: {
          text: '流程：先运行三张「分镜图」锁定角色与画风 → 双击「漫画页」进入编辑器，把分镜图拖入分格、加台词气泡、调页面背景色 → 导出成片（支持透明底 PNG）。分格与气泡支持手柄缩放。'
        }
      }
    ],
    edges: [
      { from: 'script', to: 'panel1' },
      { from: 'script', to: 'panel2' },
      { from: 'script', to: 'panel3' },
      { from: 'panel1', to: 'page', fromPort: 'out', toPort: 'in-image' },
      { from: 'panel2', to: 'page', fromPort: 'out', toPort: 'in-image' },
      { from: 'panel3', to: 'page', fromPort: 'out', toPort: 'in-image' }
    ]
  },
  courseNarrate: {
    title: '知识课程口播',
    nodes: [
      {
        key: 'script',
        typeId: 'play.script',
        title: '课程讲稿',
        params: { text: '（分段写讲稿：开场钩子、知识点、总结与引导关注）' }
      },
      {
        key: 'portrait',
        typeId: 'asset.image',
        title: '主讲人形象',
        params: { generateInstruction: '知识博主半身像，正面对镜头，简洁背景，亲和气质' }
      },
      {
        key: 'voice',
        typeId: 'asset.voice',
        title: '口播配音',
        params: { generateInstruction: '亲和清晰的知识口播音色，语速平稳，按讲稿分段朗读' }
      },
      {
        key: 'talking',
        typeId: 'asset.video',
        title: '口播视频',
        params: {
          generateInstruction: '主讲人对镜头讲话，半身构图，口型自然',
          generateDuration: 10,
          generateAspectRatio: '9:16'
        }
      },
      { key: 'lipSync', typeId: 'video.lipSync', title: '口型同步' },
      {
        key: 'note',
        typeId: 'note.text',
        title: '使用说明',
        params: {
          text: '流程：先运行「主讲人形象」与「课程讲稿」→ 用形象生成「口播视频」（视频音量建议静音）→ 运行「口播配音」→ 把口播视频与配音接进「口型同步」运行，输出对口型的成片。配音不满意可只重跑配音，无需重做视频。'
        }
      }
    ],
    edges: [
      { from: 'script', to: 'portrait' },
      { from: 'script', to: 'voice' },
      { from: 'script', to: 'talking' },
      { from: 'portrait', to: 'talking', fromPort: 'out', toPort: 'in-image' },
      { from: 'talking', to: 'lipSync', fromPort: 'out', toPort: 'in-video' },
      { from: 'voice', to: 'lipSync', fromPort: 'out', toPort: 'in-voice' }
    ]
  },
  directorPreviz: {
    title: '3D 白模预演',
    nodes: [
      {
        key: 'brief',
        typeId: 'play.script',
        title: '分镜与场景需求',
        params: { text: '（描述场景氛围、镜头景别与构图意图）' }
      },
      {
        key: 'pano',
        typeId: 'asset.image',
        title: '全景氛围参考',
        params: { generateInstruction: '生成场景 360 全景氛围图，透视与光线方向明确' }
      },
      { key: 'motion', typeId: 'asset.motion', title: '导演台·AI 白模' },
      { key: 'select', typeId: 'image.select', title: '选站位图' },
      {
        key: 'video',
        typeId: 'asset.video',
        title: '预演成片',
        params: {
          generateInstruction: '按站位图构图生成预演视频，保持分镜景别',
          generateDuration: 8
        }
      },
      {
        key: 'note',
        typeId: 'note.text',
        title: '使用说明',
        params: {
          text: '流程：运行「全景氛围参考」→ 连到「导演台·AI 白模」的全景口，双击进入舞台自动设为背景 → 点「生成3D白模」，丢最多 3 张透视 / 360 全景参考图与一句话指令，AI 用基础几何体搭出整座场景（人物当 1.7m 比例尺）→ 摆机位、截站位图 → 「选站位图」后生成预演成片，构图提前锁死。'
        }
      }
    ],
    edges: [
      { from: 'brief', to: 'pano' },
      { from: 'pano', to: 'motion', fromPort: 'out', toPort: 'in-panorama' },
      { from: 'motion', to: 'select', fromPort: 'out-shots', toPort: 'in' },
      { from: 'select', to: 'video', fromPort: 'out', toPort: 'in-image' },
      { from: 'brief', to: 'video', fromPort: 'out', toPort: 'in-text' }
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
