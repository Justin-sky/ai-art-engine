import type { GraphPlan } from './graphPlan'
import { serializeComicPage } from './comicPage'

/** 批量图标整版表统一规范尾句（线宽 / 圆角 / 内边距 / 最小可读），追加到每类图标整版节点指令 */
const ICON_SHEET_SPEC_TAIL =
  ' 图标统一规范：等线宽描边、同一圆角与内边距比例、主体简洁高对比（缩小到 16px 仍可辨）、每格一枚完整图标、不画任何文字、不画网格线与外框；名单不足 9 枚时其余格为纯色空白底。'

const FILM_SCRIPT_PLACEHOLDER =
  '（在此填写剧本 / 故事梗概；也可以先用「剧本生成」节点产出后接入分镜拆解）'

/**
 * 影视全流程（闭环）：剧本 → 分镜拆解 → 导演审核（自动修订）→ 角色场景设定 → 批量拍摄（关键帧质检 + 图生视频）。
 *
 * 镜头数量由剧情决定（不再固定 9 / 36 格）；中间产物全部是结构化分镜文档，
 * 改一镜只重拍一镜（批量拍摄按提示词指纹增量缓存）。
 */
function buildFilmPipelinePlan(): GraphPlan {
  return {
    title: '影视全流程（Agent 闭环）',
    nodes: [
      {
        key: 'script',
        typeId: 'play.script',
        title: '剧本',
        params: { text: FILM_SCRIPT_PLACEHOLDER }
      },
      {
        key: 'breakdown',
        typeId: 'film.breakdown',
        title: '分镜拆解',
        params: { filmAspectRatio: '9:16', filmTargetShots: 0 }
      },
      {
        key: 'review',
        typeId: 'film.review',
        title: '导演审核',
        params: { filmReviewMaxRounds: 2 }
      },
      {
        key: 'cast',
        typeId: 'film.cast',
        title: '角色场景设定',
        params: { filmCastKinds: 'character,location' }
      },
      {
        key: 'render',
        typeId: 'film.render',
        title: '批量拍摄',
        params: { filmRenderMode: 'video', filmRenderQc: true, filmRenderMaxRetries: 1 }
      },
      {
        key: 'note',
        typeId: 'note.text',
        title: '流水线说明',
        params: {
          text: `流程：剧本 → 分镜拆解（结构化分镜：场 / 镜头 / 角色场景实体，镜头数随剧情）→ 导演审核（不通过的镜头自动修订后复审，最多 2 轮）→ 角色场景设定（每个角色 / 地点一张设定图）→ 批量拍摄（按镜头出场名单自动带设定图出关键帧 → 视觉质检不合格自动重拍 → 以关键帧为首帧图生视频）。

迭代：在检查器里改任一镜头或「锁定」满意的镜头后重跑，锁定镜头不会被 AI 改写；批量拍摄只重拍提示词变化的镜头。

精修：需要单独打磨某一镜时，从导演审核接一个「镜头」节点，再接图片 / 视频生成节点手动调参。`
        }
      }
    ],
    edges: [
      { from: 'script', to: 'breakdown', fromPort: 'out', toPort: 'in' },
      { from: 'script', to: 'review', fromPort: 'out', toPort: 'in-script' },
      { from: 'breakdown', to: 'review', fromPort: 'out', toPort: 'in' },
      { from: 'review', to: 'cast', fromPort: 'out', toPort: 'in' },
      { from: 'review', to: 'render', fromPort: 'out', toPort: 'in' },
      { from: 'cast', to: 'render', fromPort: 'out', toPort: 'in-cast' }
    ]
  }
}

/**
 * 影视精修（单镜头工作台）：剧本 → 分镜拆解 → 导演审核 → 角色场景设定 → 镜头 → 图片生成（关键帧）→ 视频生成。
 * 镜头节点按序号 / id 取一镜，自动输出关键帧提示词、动态提示词与该镜出场设定图；复制镜头节点即可精修多镜。
 */
function buildFilmShotPlan(): GraphPlan {
  return {
    title: '影视精修（单镜头工作台）',
    nodes: [
      {
        key: 'script',
        typeId: 'play.script',
        title: '剧本',
        params: { text: FILM_SCRIPT_PLACEHOLDER }
      },
      {
        key: 'breakdown',
        typeId: 'film.breakdown',
        title: '分镜拆解',
        params: { filmAspectRatio: '16:9' }
      },
      {
        key: 'review',
        typeId: 'film.review',
        title: '导演审核',
        params: { filmReviewMaxRounds: 1 }
      },
      {
        key: 'cast',
        typeId: 'film.cast',
        title: '角色场景设定',
        params: { filmCastKinds: 'character,location' }
      },
      { key: 'shot', typeId: 'film.shot', title: '镜头 1', params: { filmShotRef: '1' } },
      {
        key: 'keyframe',
        typeId: 'asset.image',
        title: '关键帧',
        params: { generateAspectRatio: '16:9' }
      },
      {
        key: 'clip',
        typeId: 'asset.video',
        title: '镜头视频',
        params: { generateAspectRatio: '16:9', generateDuration: 5 }
      },
      {
        key: 'note',
        typeId: 'note.text',
        title: '使用说明',
        params: {
          text: '运行到「角色场景设定」后，在「镜头」节点检查器里切换镜头序号 / id：它自动输出该镜关键帧提示词（接关键帧图片生成）、出场角色与地点设定图（接参考图口锁一致性）与动态提示词（接视频生成）。复制「镜头 → 关键帧 → 镜头视频」这一组即可并行精修多镜。'
        }
      }
    ],
    edges: [
      { from: 'script', to: 'breakdown', fromPort: 'out', toPort: 'in' },
      { from: 'script', to: 'review', fromPort: 'out', toPort: 'in-script' },
      { from: 'breakdown', to: 'review', fromPort: 'out', toPort: 'in' },
      { from: 'review', to: 'cast', fromPort: 'out', toPort: 'in' },
      { from: 'review', to: 'shot', fromPort: 'out', toPort: 'in' },
      { from: 'cast', to: 'shot', fromPort: 'out', toPort: 'in-cast' },
      { from: 'shot', to: 'keyframe', fromPort: 'out', toPort: 'in-text' },
      { from: 'shot', to: 'keyframe', fromPort: 'out-refs', toPort: 'in-image' },
      { from: 'keyframe', to: 'clip', fromPort: 'out', toPort: 'in-image' },
      { from: 'shot', to: 'clip', fromPort: 'out-motion', toPort: 'in-text' }
    ]
  }
}

/** 一键工作流预设 id（文案在 i18n `aiWorkflow.presets.<id>.*`） */
export const AI_WORKFLOW_PRESET_IDS = [
  'gameUaVideo',
  'characterSheet',
  'storyboardVideo',
  'productAd',
  'gameUi',
  'gameIcons',
  'ecomAdDeep',
  'game3dAsset',
  'worldModel',
  'comicPublish',
  'courseNarrate',
  'directorPreviz',
  'shortDrama',
  'shortDrama9',
  'anim2dGif',
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
  gameIcons: {
    title: '游戏图标包',
    nodes: [
      {
        key: 'scriptTheme',
        typeId: 'play.script',
        title: '画风主题',
        params: {
          text: '画风主题（示例）：暖色 2D 卡通、浅色卡片底、描边统一——可按需改写主题句，正式风格以「风格参考图 → UI/图标」为准。'
        }
      },
      {
        key: 'skillNames',
        typeId: 'play.script',
        title: '技能图标名单',
        params: {
          text: '火焰斩\n冰霜护盾\n雷击\n冲刺\n治疗术\n狂暴\n破甲\n圣光祝福'
        }
      },
      {
        key: 'skillSheet',
        typeId: 'asset.image',
        title: '技能图标·整版',
        params: {
          generateInstruction:
            '按名单顺序，绘制一张 3 行 × 3 列均匀九宫格的技能图标整版表（战斗招式风格）：每格一枚独立技能图标，格子自左向右、逐行对应名单顺序。' +
            ICON_SHEET_SPEC_TAIL,
          generateAspectRatio: '1:1'
        }
      },
      {
        key: 'skillSplit',
        typeId: 'image.gridSplit',
        title: '技能图标·切格',
        params: {
          imageGridSplit: {
            rows: 3,
            cols: 3,
            selected: []
          }
        }
      },
      {
        key: 'skillPack',
        typeId: 'image.iconPack',
        title: '技能图标·打包',
        params: {
          iconPack: {
            rows: 3,
            cols: 3,
            edgeInset: 'auto',
            keyColor: 'auto',
            distance: 40,
            feather: 34,
            canvasSize: 0
          },
          mediaOutputDir: 'Assets/IconPacks/skill'
        }
      },
      {
        key: 'itemNames',
        typeId: 'play.script',
        title: '道具图标名单',
        params: {
          text: '体力药水\n金币袋\n钥匙\n魔法卷轴\n地图\n护身符'
        }
      },
      {
        key: 'itemSheet',
        typeId: 'asset.image',
        title: '道具图标·整版',
        params: {
          generateInstruction:
            '按名单顺序，绘制一张 3 行 × 3 列均匀九宫格的道具图标整版表（物品物件风格）：每格一枚独立道具图标，格子自左向右、逐行对应名单顺序。' +
            ICON_SHEET_SPEC_TAIL,
          generateAspectRatio: '1:1'
        }
      },
      {
        key: 'itemSplit',
        typeId: 'image.gridSplit',
        title: '道具图标·切格',
        params: {
          imageGridSplit: {
            rows: 3,
            cols: 3,
            selected: []
          }
        }
      },
      {
        key: 'itemPack',
        typeId: 'image.iconPack',
        title: '道具图标·打包',
        params: {
          iconPack: {
            rows: 3,
            cols: 3,
            edgeInset: 'auto',
            keyColor: 'auto',
            distance: 40,
            feather: 34,
            canvasSize: 0
          },
          mediaOutputDir: 'Assets/IconPacks/item'
        }
      },
      {
        key: 'statusNames',
        typeId: 'play.script',
        title: '状态图标名单',
        params: {
          text: '中毒\n灼烧\n冰冻\n护盾\n眩晕\n虚弱\n流血'
        }
      },
      {
        key: 'statusSheet',
        typeId: 'asset.image',
        title: '状态图标·整版',
        params: {
          generateInstruction:
            '按名单顺序，绘制一张 3 行 × 3 列均匀九宫格的状态图标整版表（状态徽记风格）：每格一枚独立状态图标，格子自左向右、逐行对应名单顺序。' +
            ICON_SHEET_SPEC_TAIL,
          generateAspectRatio: '1:1'
        }
      },
      {
        key: 'statusSplit',
        typeId: 'image.gridSplit',
        title: '状态图标·切格',
        params: {
          imageGridSplit: {
            rows: 3,
            cols: 3,
            selected: []
          }
        }
      },
      {
        key: 'statusPack',
        typeId: 'image.iconPack',
        title: '状态图标·打包',
        params: {
          iconPack: {
            rows: 3,
            cols: 3,
            edgeInset: 'auto',
            keyColor: 'auto',
            distance: 40,
            feather: 34,
            canvasSize: 0
          },
          mediaOutputDir: 'Assets/IconPacks/status'
        }
      },
      {
        key: 'note',
        typeId: 'note.text',
        title: '使用说明',
        params: {
          text: '使用流程：1) 在「画风主题」填主题句；在「技能/道具/状态图标名单」各填一枚一行的名单（每类 ≤9 枚，名单顺序即整版表逐行格位，如 1-1 = 第 1 枚；改名单后对应「·整版」需重跑）；2) 为工程选择「UI / 图标」风格参考图，保证三类同一画风；3) 运行各「·整版」节点生成 3×3 方形卡片整版表；4) 运行各「·打包」节点：从整版逐格裁切 → 采样纯色底键控透明 → 修剪并统一画布中心对齐 → 按名单命名 PNG 落盘 Assets/IconPacks/…，并同目录写 icons.txt 清单（含 cellKey↔名单映射、文件名、锚点）；5) 「·切格」节点仅用于单枚检查/精修（逐枚 dive 后续再做）。打包前建议先跑一次「·切格」目检格位；若名单占满 9 枚无空白格，键控自动退回版面外框采样。'
        }
      }
    ],
    edges: [
      { from: 'scriptTheme', to: 'skillSheet' },
      { from: 'skillNames', to: 'skillSheet' },
      { from: 'skillSheet', to: 'skillSplit' },
      { from: 'skillNames', to: 'skillPack' },
      { from: 'skillSheet', to: 'skillPack' },
      { from: 'scriptTheme', to: 'itemSheet' },
      { from: 'itemNames', to: 'itemSheet' },
      { from: 'itemSheet', to: 'itemSplit' },
      { from: 'itemNames', to: 'itemPack' },
      { from: 'itemSheet', to: 'itemPack' },
      { from: 'scriptTheme', to: 'statusSheet' },
      { from: 'statusNames', to: 'statusSheet' },
      { from: 'statusSheet', to: 'statusSplit' },
      { from: 'statusNames', to: 'statusPack' },
      { from: 'statusSheet', to: 'statusPack' }
    ]
  },
  ecomAdDeep: {
    title: '电商带货·变体',
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
      { key: 'split', typeId: 'image.layerSplit', title: '图层分离' },
      {
        key: 'note',
        typeId: 'note.text',
        title: '使用说明',
        params: {
          text: '流程：运行「产品主视觉 / 使用场景图」→ 双击「广告变体矩阵」配置产品描述与变体维度，批量生成多版本 → 需要改详情页文字层时，把主视觉接入「图层分离」分层导出（PSD / PNG）。'
        }
      }
    ],
    edges: [
      { from: 'copy', to: 'hero' },
      { from: 'copy', to: 'scene' },
      { from: 'hero', to: 'adVariants' },
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
          text: '流程：运行两个「3D 模型」节点生成 GLB → 连到「导演台预演」后双击进入舞台，模型自动实例化；在舞台里用基础几何体补景、摆机位 → 截取站位图（out-shots）→ 经「选站位图」挑一张生成展示视频。配套道具模型可随时替换接入导演台。'
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
  /**
   * 世界模型：一条从「文字/参考图」到「可漫游世界」再到「导演台」的直链。
   *
   * 注意端口的严格同类型：世界生成节点出口是 `spatialWorld`，**只能**接「空间世界导出」，
   * 不能直接接导演台（`model` 口不隐式兼容）。导出后的产物才是 `model`，
   * 从这里接导演台的 `in-model` —— 这也是这条链必须存在导出节点的原因。
   */
  worldModel: {
    title: '世界模型（空间世界 → 导演台）',
    nodes: [
      {
        key: 'brief',
        typeId: 'play.script',
        title: '世界设定与漫游意图',
        params: {
          text: '（描述场景：环境、时代、天气、光线、材质氛围，以及镜头想怎么走）'
        }
      },
      {
        key: 'world',
        typeId: 'asset.spatialWorld',
        title: '空间世界生成',
        params: {
          generateInstruction: '按设定生成可漫游的 3D 世界，空间结构完整、光线方向明确',
          // 单图参考是否按等距柱状全景处理；关掉 recaption 让指令原文直送（可复现）
          spatialWorldPanoMode: 'auto',
          spatialWorldDisableRecaption: false
        }
      },
      {
        key: 'export',
        typeId: 'spatialWorld.export',
        title: '空间世界导出',
        params: {
          // mesh：HQ 贴图网格（GLB，登记模型资产）→ 导演台能直接用；splats：PLY 泼溅
          spatialWorldExportMode: 'mesh',
          spatialWorldExportVariant: 'textured',
          spatialWorldExportResolution: 'full_res'
        }
      },
      { key: 'motion', typeId: 'asset.motion', title: '导演台预演' },
      { key: 'select', typeId: 'image.select', title: '选站位图' },
      {
        key: 'video',
        typeId: 'asset.video',
        title: '漫游成片',
        params: {
          generateInstruction: '按站位图在世界里做一次漫游运镜，保持景别与光线方向',
          generateDuration: 8
        }
      },
      {
        key: 'note',
        typeId: 'note.text',
        title: '使用说明',
        params: {
          text: '流程：运行「空间世界生成」（约 5 分钟，需在设置里配好 World Labs）→ 世界落盘为 GLB 模型资产，随世界的 SPZ 泼溅与 360 全景图一并落在同目录 → 「空间世界导出」把世界转成可编排的网格（HQ 贴图网格较慢且单独计费；只想拿泼溅就把它切成「PLY 泼溅」）→ 导出的网格接「导演台预演」的模型口，双击进入舞台自动实例化，摆机位截站位图 → 「选站位图」后生成漫游成片。\n\n端口是严格同类型的：世界生成节点的出口只能接「空间世界导出」，不能直接接导演台；导出节点产出的才是模型。\n\n世界里自带的全景图可以单独连到导演台的「全景」口当舞台背景（选节点检查器里的路径，用图片节点引入）。'
        }
      }
    ],
    edges: [
      { from: 'brief', to: 'world', fromPort: 'out', toPort: 'in-text' },
      { from: 'world', to: 'export', fromPort: 'out', toPort: 'in-world' },
      { from: 'export', to: 'motion', fromPort: 'out', toPort: 'in-model' },
      { from: 'motion', to: 'select', fromPort: 'out-shots', toPort: 'in' },
      { from: 'select', to: 'video', fromPort: 'out', toPort: 'in-image' },
      { from: 'brief', to: 'video', fromPort: 'out', toPort: 'in-text' }
    ]
  },
  comicPublish: {
    title: '漫画出版（整集连载）',
    nodes: [
      {
        key: 'script',
        typeId: 'play.script',
        title: '漫画剧本',
        params: {
          text: '（在此输入整集漫画剧本；在 AI 对话栏选择本工作流并输入剧本后，AI 会自动拆解多页分镜、锁定角色定妆，并将分格版式、斜切、镜头特效、台词气泡与音效字写入各漫画页节点后一键出片）'
        }
      },
      {
        key: 'charAnchor',
        typeId: 'asset.image',
        title: '角色与画风定妆',
        params: {
          generateInstruction:
            '根据剧本设定生成主角人设与漫画画风基准图：角色全身与面部神态设定，线条干净、色调统一，纯画面不含任何文字，作为全集所有分镜的形象参考锚点'
        }
      },
      {
        key: 'p1_1',
        typeId: 'asset.image',
        title: '第 1 页 · 格 1（开篇定场）',
        params: {
          generateInstruction:
            '第 1 页第 1 格（全景定场镜头）：按剧本展现开篇环境氛围与主角所处场景，严格保持与定妆参考图一致的画风与角色形象，纯画面不含任何文字'
        }
      },
      {
        key: 'p1_2',
        typeId: 'asset.image',
        title: '第 1 页 · 格 2（主角登场）',
        params: {
          generateInstruction:
            '第 1 页第 2 格（中景人物镜头）：主角登场动作与神态，承接第 1 格环境光影，严格保持角色服装与外貌一致，纯画面不含任何文字'
        }
      },
      {
        key: 'p1_3',
        typeId: 'asset.image',
        title: '第 1 页 · 格 3（异变突起）',
        params: {
          generateInstruction:
            '第 1 页第 3 格（近景反应镜头）：突发状况引起主角警觉或情绪转折，戏剧张力强，严格保持角色与画风一致，纯画面不含任何文字'
        }
      },
      {
        key: 'page1',
        typeId: 'comic.page',
        title: '漫画页 · 第 1 页（起承）',
        params: {
          comicPage: serializeComicPage({
            title: '第 1 页 · 起承',
            backgroundColor: '#ffffff',
            columns: 6,
            rows: 6,
            gutter: 18,
            padding: 36,
            borderWidth: 3,
            borderColor: '#111111',
            borderRadius: 0,
            width: 1080,
            height: 1520,
            panels: [
              {
                id: 'p1-panel-1',
                row: 0,
                col: 0,
                rowSpan: 2,
                colSpan: 6,
                title: '格 1 · 开篇定场',
                bubbles: [
                  {
                    id: 'p1-b1',
                    shape: 'narration',
                    text: '夜幕降临，一切看似平静……',
                    x: 0.24,
                    y: 0.24,
                    tail: 'tl',
                    scale: 1
                  }
                ]
              },
              {
                id: 'p1-panel-2',
                row: 2,
                col: 0,
                rowSpan: 4,
                colSpan: 3,
                title: '格 2 · 主角登场',
                bubbles: [
                  {
                    id: 'p1-b2',
                    shape: 'rounded',
                    speaker: '主角',
                    text: '终于找到这里了。',
                    x: 0.68,
                    y: 0.2,
                    tail: 'bl',
                    tailTipX: 0.45,
                    tailTipY: 0.42,
                    scale: 1
                  }
                ]
              },
              {
                id: 'p1-panel-3',
                row: 2,
                col: 3,
                rowSpan: 4,
                colSpan: 3,
                title: '格 3 · 异变突起',
                effectType: 'vignette',
                bubbles: [
                  {
                    id: 'p1-b3',
                    shape: 'rounded',
                    speaker: '主角',
                    text: '等等……这股气息是？！',
                    x: 0.35,
                    y: 0.22,
                    tail: 'br',
                    tailTipX: 0.55,
                    tailTipY: 0.44,
                    scale: 1.05
                  },
                  {
                    id: 'p1-b4',
                    shape: 'sfx',
                    text: '铮——！',
                    x: 0.76,
                    y: 0.8,
                    tail: 'tl',
                    scale: 1.15
                  }
                ]
              }
            ]
          })
        }
      },
      {
        key: 'p2_1',
        typeId: 'asset.image',
        title: '第 2 页 · 格 1（疾速逼近）',
        params: {
          generateInstruction:
            '第 2 页第 1 格（低角度动态镜头）：冲突爆发、危机疾速逼近的张力瞬间，严格保持角色与画风一致，纯画面不含任何文字'
        }
      },
      {
        key: 'p2_2',
        typeId: 'asset.image',
        title: '第 2 页 · 格 2（正面交锋）',
        params: {
          generateInstruction:
            '第 2 页第 2 格（高潮爆发镜头）：核心冲突正面交锋的高光瞬间，动作极具冲击力，严格保持角色与画风一致，纯画面不含任何文字'
        }
      },
      {
        key: 'p2_3',
        typeId: 'asset.image',
        title: '第 2 页 · 格 3（特写反击）',
        params: {
          generateInstruction:
            '第 2 页第 3 格（面部与眼神特写）：主角决意反击的凌厉眼神特写，光影对比强烈，严格保持角色一致，纯画面不含任何文字'
        }
      },
      {
        key: 'p2_4',
        typeId: 'asset.image',
        title: '第 2 页 · 格 4（破局一击）',
        params: {
          generateInstruction:
            '第 2 页第 4 格（广角冲击镜头）：关键一击释放出的能量与动态余波，构图饱满，严格保持角色与画风一致，纯画面不含任何文字'
        }
      },
      {
        key: 'page2',
        typeId: 'comic.page',
        title: '漫画页 · 第 2 页（高潮）',
        params: {
          comicPage: serializeComicPage({
            title: '第 2 页 · 高潮',
            backgroundColor: '#ffffff',
            columns: 6,
            rows: 6,
            gutter: 18,
            padding: 36,
            borderWidth: 3,
            borderColor: '#111111',
            borderRadius: 0,
            width: 1080,
            height: 1520,
            panels: [
              {
                id: 'p2-panel-1',
                row: 0,
                col: 0,
                rowSpan: 2,
                colSpan: 6,
                title: '格 1 · 疾速逼近',
                cornerOffsets: [0, 0, 0, 0, 0, -0.1, 0, 0.08],
                effectType: 'speed-lines',
                bubbles: [
                  {
                    id: 'p2-b1',
                    shape: 'rounded',
                    text: '来得好快！',
                    x: 0.22,
                    y: 0.28,
                    tail: 'br',
                    tailTipX: 0.42,
                    tailTipY: 0.52,
                    scale: 1
                  },
                  {
                    id: 'p2-b2',
                    shape: 'sfx',
                    text: '唰——！',
                    x: 0.8,
                    y: 0.72,
                    tail: 'tl',
                    scale: 1.2
                  }
                ]
              },
              {
                id: 'p2-panel-2',
                row: 2,
                col: 0,
                rowSpan: 2,
                colSpan: 3,
                title: '格 2 · 正面交锋',
                cornerOffsets: [0, 0.08, 0, -0.05, 0, -0.08, 0, 0.06],
                effectType: 'focus-lines',
                bubbles: [
                  {
                    id: 'p2-b3',
                    shape: 'shout',
                    speaker: '主角',
                    text: '绝不会在这里退缩！！',
                    x: 0.5,
                    y: 0.24,
                    tail: 'bl',
                    scale: 1.05
                  },
                  {
                    id: 'p2-b4',
                    shape: 'sfx',
                    text: '轰！！',
                    x: 0.78,
                    y: 0.8,
                    tail: 'tl',
                    scale: 1.3
                  }
                ]
              },
              {
                id: 'p2-panel-3',
                row: 2,
                col: 3,
                rowSpan: 2,
                colSpan: 3,
                title: '格 3 · 特写反击',
                cornerOffsets: [0, -0.05, 0, -0.1, 0, 0.06, 0, -0.08],
                bubbles: [
                  {
                    id: 'p2-b5',
                    shape: 'thought',
                    speaker: '主角',
                    text: '看清破绽了——就是现在！',
                    x: 0.52,
                    y: 0.24,
                    tail: 'bl',
                    tailTipX: 0.4,
                    tailTipY: 0.48,
                    scale: 1
                  }
                ]
              },
              {
                id: 'p2-panel-4',
                row: 4,
                col: 0,
                rowSpan: 2,
                colSpan: 6,
                title: '格 4 · 破局一击',
                cornerOffsets: [0, 0.06, 0, -0.06, 0, 0, 0, 0],
                effectType: 'speed-lines',
                bubbles: [
                  {
                    id: 'p2-b6',
                    shape: 'shout',
                    text: '破——！！',
                    x: 0.24,
                    y: 0.3,
                    tail: 'br',
                    scale: 1.15
                  }
                ]
              }
            ]
          })
        }
      },
      {
        key: 'p3_1',
        typeId: 'asset.image',
        title: '第 3 页 · 格 1（余波散尽）',
        params: {
          generateInstruction:
            '第 3 页第 1 格（中景镜头）：交锋过后烟尘渐散，主角稳住身形，承接前页剧情，严格保持角色与画风一致，纯画面不含任何文字'
        }
      },
      {
        key: 'p3_2',
        typeId: 'asset.image',
        title: '第 3 页 · 格 2（线索浮现）',
        params: {
          generateInstruction:
            '第 3 页第 2 格（特写镜头）：关键道具或神秘线索显露，引发新的悬念，严格保持画风一致，纯画面不含任何文字'
        }
      },
      {
        key: 'p3_3',
        typeId: 'asset.image',
        title: '第 3 页 · 格 3（终幕悬念大格）',
        params: {
          generateInstruction:
            '第 3 页第 3 格（史诗感大跨页收尾镜头）：远方更庞大的危机或新神秘角色剪影浮现，极具连载悬念感，严格保持角色与画风一致，纯画面不含任何文字'
        }
      },
      {
        key: 'page3',
        typeId: 'comic.page',
        title: '漫画页 · 第 3 页（收尾）',
        params: {
          comicPage: serializeComicPage({
            title: '第 3 页 · 收尾',
            backgroundColor: '#ffffff',
            columns: 6,
            rows: 6,
            gutter: 18,
            padding: 36,
            borderWidth: 3,
            borderColor: '#111111',
            borderRadius: 0,
            width: 1080,
            height: 1520,
            panels: [
              {
                id: 'p3-panel-1',
                row: 0,
                col: 0,
                rowSpan: 2,
                colSpan: 3,
                title: '格 1 · 余波散尽',
                bubbles: [
                  {
                    id: 'p3-b1',
                    shape: 'rounded',
                    speaker: '主角',
                    text: '呼……总算挡下来了。',
                    x: 0.55,
                    y: 0.24,
                    tail: 'bl',
                    tailTipX: 0.42,
                    tailTipY: 0.48,
                    scale: 1
                  }
                ]
              },
              {
                id: 'p3-panel-2',
                row: 0,
                col: 3,
                rowSpan: 2,
                colSpan: 3,
                title: '格 2 · 线索浮现',
                effectType: 'vignette',
                bubbles: [
                  {
                    id: 'p3-b2',
                    shape: 'thought',
                    speaker: '主角',
                    text: '原来这才是他们真正的目的……',
                    x: 0.5,
                    y: 0.25,
                    tail: 'bl',
                    tailTipX: 0.45,
                    tailTipY: 0.52,
                    scale: 1
                  }
                ]
              },
              {
                id: 'p3-panel-3',
                row: 2,
                col: 0,
                rowSpan: 4,
                colSpan: 6,
                title: '格 3 · 终幕悬念',
                effectType: 'focus-lines',
                bubbles: [
                  {
                    id: 'p3-b3',
                    shape: 'rounded',
                    text: '真正的考验，现在才刚刚开始。',
                    x: 0.26,
                    y: 0.2,
                    tail: 'br',
                    tailTipX: 0.45,
                    tailTipY: 0.4,
                    scale: 1.05
                  },
                  {
                    id: 'p3-b4',
                    shape: 'narration',
                    text: '【本话完 · 未完待续】',
                    x: 0.78,
                    y: 0.88,
                    tail: 'tl',
                    scale: 1
                  }
                ]
              }
            ]
          })
        }
      },
      {
        key: 'note',
        typeId: 'note.text',
        title: '使用说明',
        params: {
          text: '流程（支持 AI 一键自动生产整集漫画）：\n1. 在底部 AI 对话栏点「工作流」选中本工作流并输入一段剧本，Agent 会自动拆解多页分镜、写入「角色与画风定妆」及各格画面指令，并把分格版式、斜切破格、速度线/集中线、台词气泡与音效字写入每张「漫画页」后自动运行出片。\n2. 手动按拓扑运行：先运行「角色与画风定妆」锁定主角形象（其输出已连入全集 10 格分镜的参考图端口）→ 批量运行各页「分镜图」→ 运行三张「漫画页」直接合成带气泡与版式的整集漫画 PNG。\n3. 双击任意「漫画页」可 Dive 进入专业排版工作台，切换 12 款分镜版式、拖拽斜切顶点、调节格内构图/漫画网点滤镜与 6 种台词气泡。'
        }
      }
    ],
    edges: [
      { from: 'script', to: 'charAnchor', fromPort: 'out', toPort: 'in-text' },
      { from: 'script', to: 'p1_1', fromPort: 'out', toPort: 'in-text' },
      { from: 'script', to: 'p1_2', fromPort: 'out', toPort: 'in-text' },
      { from: 'script', to: 'p1_3', fromPort: 'out', toPort: 'in-text' },
      { from: 'charAnchor', to: 'p1_1', fromPort: 'out', toPort: 'in-image' },
      { from: 'charAnchor', to: 'p1_2', fromPort: 'out', toPort: 'in-image' },
      { from: 'charAnchor', to: 'p1_3', fromPort: 'out', toPort: 'in-image' },
      { from: 'p1_1', to: 'page1', fromPort: 'out', toPort: 'in-image' },
      { from: 'p1_2', to: 'page1', fromPort: 'out', toPort: 'in-image' },
      { from: 'p1_3', to: 'page1', fromPort: 'out', toPort: 'in-image' },
      { from: 'script', to: 'p2_1', fromPort: 'out', toPort: 'in-text' },
      { from: 'script', to: 'p2_2', fromPort: 'out', toPort: 'in-text' },
      { from: 'script', to: 'p2_3', fromPort: 'out', toPort: 'in-text' },
      { from: 'script', to: 'p2_4', fromPort: 'out', toPort: 'in-text' },
      { from: 'charAnchor', to: 'p2_1', fromPort: 'out', toPort: 'in-image' },
      { from: 'charAnchor', to: 'p2_2', fromPort: 'out', toPort: 'in-image' },
      { from: 'charAnchor', to: 'p2_3', fromPort: 'out', toPort: 'in-image' },
      { from: 'charAnchor', to: 'p2_4', fromPort: 'out', toPort: 'in-image' },
      { from: 'p2_1', to: 'page2', fromPort: 'out', toPort: 'in-image' },
      { from: 'p2_2', to: 'page2', fromPort: 'out', toPort: 'in-image' },
      { from: 'p2_3', to: 'page2', fromPort: 'out', toPort: 'in-image' },
      { from: 'p2_4', to: 'page2', fromPort: 'out', toPort: 'in-image' },
      { from: 'script', to: 'p3_1', fromPort: 'out', toPort: 'in-text' },
      { from: 'script', to: 'p3_2', fromPort: 'out', toPort: 'in-text' },
      { from: 'script', to: 'p3_3', fromPort: 'out', toPort: 'in-text' },
      { from: 'charAnchor', to: 'p3_1', fromPort: 'out', toPort: 'in-image' },
      { from: 'charAnchor', to: 'p3_2', fromPort: 'out', toPort: 'in-image' },
      { from: 'charAnchor', to: 'p3_3', fromPort: 'out', toPort: 'in-image' },
      { from: 'p3_1', to: 'page3', fromPort: 'out', toPort: 'in-image' },
      { from: 'p3_2', to: 'page3', fromPort: 'out', toPort: 'in-image' },
      { from: 'p3_3', to: 'page3', fromPort: 'out', toPort: 'in-image' }
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
    title: '3D 导演台预演',
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
      { key: 'motion', typeId: 'asset.motion', title: '导演台预演' },
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
          text: '流程：运行「全景氛围参考」→ 连到「导演台预演」的全景口，双击进入舞台自动设为背景 → 用基础几何体手动搭景、摆机位、截站位图 → 「选站位图」后生成预演成片，构图提前锁死。'
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
  anim2dGif: {
    title: '2D 帧动画（GIF）',
    nodes: [
      {
        key: 'sheet',
        typeId: 'asset.image',
        title: '动作序列图',
        params: {
          generateInstruction:
            '为同一角色生成「行走」动作的序列图（sprite sheet）：一张图内按 1 行 4 列分格，帧序从左到右，格子无缝拼接、无边框与分隔线，纯色干净背景，各格角色的外观、体型、配色与画风完全一致，仅姿态不同' // cjk-ok
        }
      },
      {
        key: 'anim',
        typeId: 'anim.2d',
        title: '2D帧动画',
        params: {
          animRows: 1,
          animCols: 4,
          animPresetId: 'walk',
          animInstruction: '角色侧面行走循环：完整步态周期，四肢摆动自然，各帧外形一致',
          animKeyColor: 'auto',
          animStabilize: 'ground',
          animGifFps: 12
        }
      },
      {
        key: 'note',
        typeId: 'note.text',
        title: '出图说明',
        params: {
          text: '运行后「2D帧动画」节点按行列切出逐帧 PNG（out 帧 / out-all 全部帧），自动抠底并按脚底原地稳像（animKeyColor=auto, animStabilize=ground），再经 out-gif 端口产出 GIF 动图（animGifFps=12）；也可直接把动作视频连到 in-video 端口抽帧转序列图，或双击节点进入全屏帧动画工作台。' // cjk-ok
        }
      }
    ],
    edges: [{ from: 'sheet', to: 'anim' }]
  },
  shortDrama: buildFilmPipelinePlan(),
  shortDrama9: buildFilmShotPlan()
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
