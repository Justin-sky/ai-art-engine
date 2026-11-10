/**
 * AI 漫剧 21 题材全流程工程化引擎（完整对齐 `ai-manju-skills` 五阶段规范）
 *
 * 覆盖四大分类、21 个细分漫剧题材：
 * - 幻想（5）：玄幻修仙、西幻魔法、星际机甲、系统无限流、末日废土
 * - 古代（6）：古代穿越重生、宫斗、宅斗、权谋朝堂、武侠江湖、古代种田经商
 * - 现代（8）：都市逆袭、总裁甜宠、家庭伦理、现代重生复仇、职场商战、年代文、娱乐圈、大学校园青春
 * - 类型片（2）：悬疑刑侦、民俗怪谈
 *
 * 每个题材内置：
 * 1. 阶段1（立项与13节企划案）：专属第3项（世界/力量/身份/案件体系）、第10项（逐集进度与招式/证据表）、第11项（空间尺寸与世界光线地图）及防踩坑铁律
 * 2. 阶段2（全季资产库 STYLE01 + P/D/S/FX）：人物卡前缀、道具卡前缀、场景空景卡前缀、人物防网红脸/防穿帮负面词
 * 3. 阶段3（分集剧本）：单集建议镜数区间、单镜时长区间、全集对白字数区间（开口对白 ≥ 2/3）、本集进度公式
 * 4. 阶段4（导演手册 A段5行分镜图 + B段多参7行视频 + 11项连续性体检）：视频尾缀 `[视觉风格：...]` 与题材连续性规则
 * 5. 阶段5（分集发布包）：竖版 3:4 / 横版 4:3 封面规范、片尾卡与下集预告、三角度标题与话题标签
 */

export type ManjuCategoryId = 'fantasy' | 'ancient' | 'modern' | 'genre'

export type ManjuGenreId =
  | 'xuanhuan-manju'
  | 'xihuan-manju'
  | 'xingji-manju'
  | 'xitong-manju'
  | 'moshi-manju'
  | 'chuanyue-manju'
  | 'gongdou-manju'
  | 'zhaidou-manju'
  | 'quanmou-manju'
  | 'wuxia-manju'
  | 'zhongtian-manju'
  | 'dushi-manju'
  | 'tianchong-manju'
  | 'jiating-manju'
  | 'chongsheng-manju'
  | 'shangzhan-manju'
  | 'niandai-manju'
  | 'yule-manju'
  | 'xiaoyuan-manju'
  | 'xuanyi-manju'
  | 'minsu-manju'

export interface ManjuCategorySpec {
  id: ManjuCategoryId
  labelZh: string
  labelEn: string
}

export const MANJU_CATEGORIES: readonly ManjuCategorySpec[] = [
  { id: 'fantasy', labelZh: '幻想题材', labelEn: 'Fantasy & Sci-Fi' },
  { id: 'ancient', labelZh: '古代题材', labelEn: 'Ancient & Historical' },
  { id: 'modern', labelZh: '现代题材', labelEn: 'Modern & Urban' },
  { id: 'genre', labelZh: '悬疑怪谈', labelEn: 'Suspense & Folklore' }
]

export interface ManjuGenreSpec {
  id: ManjuGenreId
  category: ManjuCategoryId
  nameZh: string
  nameEn: string
  audienceZh: string
  audienceEn: string
  /** 单集推荐镜头数区间 [min, max] */
  shotCountRange: [number, number]
  /** 单镜推荐时长区间（秒）[min, max] */
  shotDurationRangeSec: [number, number]
  /** 单集总对白推荐字数区间 [min, max]（开口对白须 ≥ 2/3） */
  dialogueCharsRange: [number, number]
  /** 核心美术风格短语（用于立项卡与 A 段第 5 行） */
  visualStyleZh: string
  visualStyleEn: string
  /** B 段视频提示词末尾锁定的 `[视觉风格：...]` */
  videoStyleTagZh: string
  videoStyleTagEn: string
  /** 阶段2：人物卡（P01...）提示词前缀 */
  characterPromptPrefixZh: string
  characterPromptPrefixEn: string
  /** 阶段2：道具卡（D01...）提示词前缀 */
  propPromptPrefixZh: string
  propPromptPrefixEn: string
  /** 阶段2：场景空景卡（S01...）提示词前缀 */
  scenePromptPrefixZh: string
  scenePromptPrefixEn: string
  /** 阶段2：人物卡专属负面提示词（防网红脸、防穿帮、防三视图不一致） */
  characterNegativePromptZh: string
  characterNegativePromptEn: string
  /** 阶段1 企划案第3节：专属核心体系表定义 */
  bibleSection3TitleZh: string
  /** 阶段1 企划案第10节：专属逐集进度表定义 */
  bibleSection10TitleZh: string
  /** 阶段1 企划案第11节：专属地图与空间尺寸表定义 */
  bibleSection11TitleZh: string
  /** 阶段3 分集剧本：本集进度字段公式（以 ｜ 分隔） */
  episodeProgressTemplateZh: string
  /** 阶段1/3/4 踩坑铁律与连续性专属校验规则 */
  pitfallRulesZh: string[]
  /** 是否严禁现实品牌标识与现代电子产品（用于连续性检查） */
  forbidBrandLogos?: boolean
  /** 是否严禁现代服饰与现代器物（古风/年代防穿帮） */
  forbidModernItems?: boolean
  /** 自动识别关键词权重词表 */
  keywords: string[]
}

export const MANJU_GENRE_SPECS: readonly ManjuGenreSpec[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // 一、幻想题材（5 个）
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'xuanhuan-manju',
    category: 'fantasy',
    nameZh: '玄幻修仙',
    nameEn: 'Xianxia & Dark Xuanhuan',
    audienceZh: '男频热血爽剧',
    audienceEn: 'Male-oriented Action Fantasy',
    shotCountRange: [34, 48],
    shotDurationRangeSec: [3, 10],
    dialogueCharsRange: [250, 450],
    visualStyleZh: '东方暗黑玄幻国漫，电影级2.5D动画',
    visualStyleEn: 'Oriental dark xuanhuan Chinese animation, cinematic 2.5D',
    videoStyleTagZh:
      '东方暗黑玄幻国漫，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实布料、金属、岩石材质，高反差电影光影，玄黑赤金主色，9:16竖屏',
    videoStyleTagEn:
      'Oriental dark xuanhuan donghua, cinematic 2.5D animation texture, mature realistic proportions, detailed facial features and hair strands, authentic fabric/metal/rock materials, high-contrast lighting, obsidian black and crimson gold palette, 9:16 vertical',
    characterPromptPrefixZh:
      '东方暗黑玄幻国漫角色设定图，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实布料与金属材质，柔和均匀的影棚光，中性浅灰纯色背景',
    characterPromptPrefixEn:
      'Oriental dark xuanhuan character turnaround sheet, cinematic 2.5D animation texture, mature realistic proportions, authentic fabric and metal textures, soft even studio lighting, neutral light-grey solid background',
    propPromptPrefixZh:
      '东方暗黑玄幻国漫道具设定图，电影级2.5D渲染质感，单主体居中，真实材质与磨损细节，45度俯视，柔和影棚光，中性深灰纯色背景',
    propPromptPrefixEn:
      'Oriental dark xuanhuan prop design sheet, cinematic 2.5D render, single centered object, authentic wear and material details, 45-degree top-down view, soft studio light, neutral dark-grey solid background',
    scenePromptPrefixZh:
      '东方暗黑玄幻国漫场景概念图，电影级2.5D环境绘制，真实空间透视与纵深，无人物，9:16竖构图',
    scenePromptPrefixEn:
      'Oriental dark xuanhuan environment concept art, cinematic 2.5D matte painting, realistic spatial perspective and depth, empty of people, 9:16 vertical composition',
    characterNegativePromptZh:
      '三视图人物不一致，多余手指，五官扭曲，比例失调，Q版，卡通，真人实拍，塑料皮肤，磨皮滤镜，网红脸，锥子脸，欧式大双眼皮，美瞳，浓妆，现代服饰，文字，水印，复杂背景',
    characterNegativePromptEn:
      'inconsistent turnaround views, extra fingers, distorted face, chibi, cartoon, live-action photo, plastic skin, airbrushed filter, influencer face, modern clothing, text, watermark, complex background',
    bibleSection3TitleZh:
      '世界观与修炼体系（世界层级表、境界表、金手指阶位表含开启集数、力量限制与每次动用代价）',
    bibleSection10TitleZh: '战力与招式（逐集战力表、主角招式表含原理/视觉/音效/代价、对手招式表）',
    bibleSection11TitleZh:
      '世界地图与空间（宗门或主要地点的方位布局表、主要场景尺寸表与世界光方向）',
    episodeProgressTemplateZh: '本集对手｜战力变化｜用了什么招式｜代价',
    pitfallRulesZh: [
      '力量要有上限和代价：金手指分阶段解锁，写清哪一集开哪一阶，每次动用付出什么代价，身体损耗逐集累积不能自动恢复',
      '反派按小人→执事/内门→长老→宗主/幕后黑手逐层递进，禁止越级乱打',
      '主色区分：主角、反派、金手指各定一个主色，避免全员金色或全员蓝色撞色',
      '打斗分镜图（A段）只画交手前蓄势或交手后收招的稳定静止瞬间，挥砍与爆破过程全部交给视频（B段）'
    ],
    forbidModernItems: true,
    keywords: [
      '修仙',
      '玄幻',
      '宗门',
      '境界',
      '筑基',
      '金丹',
      '元婴',
      '灵根',
      '废柴',
      '退婚',
      '剑修',
      '法宝',
      '丹药',
      '天劫',
      '长老',
      '灵气'
    ]
  },
  {
    id: 'xihuan-manju',
    category: 'fantasy',
    nameZh: '西幻魔法',
    nameEn: 'Western Fantasy & Magic',
    audienceZh: '奇幻爽文向',
    audienceEn: 'Epic Magic & Kingdom Fantasy',
    shotCountRange: [30, 42],
    shotDurationRangeSec: [3, 10],
    dialogueCharsRange: [250, 450],
    visualStyleZh: '西幻厚涂国漫，电影级2.5D动画',
    visualStyleEn: 'Western fantasy impasto Chinese animation, cinematic 2.5D',
    videoStyleTagZh:
      '西幻厚涂国漫，电影级2.5D动画质感，成熟写实比例，细腻五官与发丝，真实布料、金属与石质建筑材质，厚涂笔触，丰富电影光影，9:16竖屏',
    videoStyleTagEn:
      'Western fantasy impasto 2.5D animation, mature realistic proportions, detailed facial features, authentic fabric/plate armor/stone architecture, rich cinematic lighting, 9:16 vertical',
    characterPromptPrefixZh:
      '西幻厚涂国漫角色设定图，电影级2.5D动画质感，厚涂笔触，成熟写实比例，细腻五官与发丝，真实布料与金属盔甲质感，柔和均匀的影棚光，中性浅灰纯色背景',
    characterPromptPrefixEn:
      'Western fantasy impasto character sheet, cinematic 2.5D animation, painterly brushstrokes, realistic armor and fabric textures, soft studio lighting, neutral light-grey solid background',
    propPromptPrefixZh:
      '西幻厚涂道具设定图，电影级2.5D渲染质感，单主体居中，真实材质与使用痕迹，45度俯视，柔和影棚光，中性深灰纯色背景',
    propPromptPrefixEn:
      'Western fantasy impasto prop sheet, cinematic 2.5D render, single centered object, 45-degree top-down view, neutral dark-grey solid background',
    scenePromptPrefixZh:
      '西幻厚涂场景概念图，电影级2.5D环境绘制，哥特与中世纪建筑，真实空间透视与纵深，无人物，9:16竖构图',
    scenePromptPrefixEn:
      'Western fantasy impasto environment concept art, gothic and medieval architecture, realistic spatial depth, empty of people, 9:16 vertical',
    characterNegativePromptZh:
      '多余手指，五官扭曲，比例失调，Q版，卡通，真人实拍，塑料皮肤，磨皮滤镜，网红脸，锥子脸，美瞳，现代服饰，文字，水印，复杂背景',
    characterNegativePromptEn:
      'extra fingers, distorted face, chibi, cartoon, live-action photo, plastic skin, modern clothing, text, watermark, complex background',
    bibleSection3TitleZh:
      '魔法与世界体系（王国与种族表、魔法等级表、元素或流派表、贵族爵位表、金手指规则与限制）',
    bibleSection10TitleZh:
      '实力进度（逐集实力表：本集对手、魔法等级、胜负方式、代价；魔法招式表含原理/视觉/音效/代价；对手招式表）',
    bibleSection11TitleZh: '世界地图与空间（王国方位表、学院或城堡布局表、主要场景尺寸表）',
    episodeProgressTemplateZh: '本集对手｜魔法等级｜胜负方式｜代价',
    pitfallRulesZh: [
      '魔法咏唱、法阵颜色与元素克制关系前后严格一致，施法魔力消耗逐场累积',
      '贵族爵位、礼仪称谓与纹章配色固定，禁止混用现代口语与东方修仙术语',
      '施法与魔兽战斗分镜图只画法杖举起蓄力或法术落地后的静止瞬间，光束爆炸过程交给视频'
    ],
    forbidModernItems: true,
    keywords: [
      '魔法',
      '法师',
      '魔导',
      '骑士',
      '贵族',
      '公爵',
      '圣女',
      '魔王',
      '教会',
      '精灵',
      '巨龙',
      '学院',
      '法阵',
      '魔力',
      '西幻'
    ]
  },
  {
    id: 'xingji-manju',
    category: 'fantasy',
    nameZh: '星际机甲',
    nameEn: 'Interstellar Mecha Sci-Fi',
    audienceZh: '男频科幻爽文向',
    audienceEn: 'Hard Sci-Fi & Mecha Action',
    shotCountRange: [30, 42],
    shotDurationRangeSec: [3, 10],
    dialogueCharsRange: [250, 400],
    visualStyleZh: '硬派科幻CG国漫，电影级2.5D动画',
    visualStyleEn: 'Hard sci-fi CG Chinese animation, cinematic 2.5D',
    videoStyleTagZh:
      '硬派科幻CG国漫，电影级2.5D动画质感，成熟写实动漫比例，真实金属硬表面质感，高反差电影光影，冷蓝与橙色对比，9:16竖屏',
    videoStyleTagEn:
      'Hard sci-fi CG 2.5D animation, mature realistic proportions, hard-surface metal materials, high-contrast teal and orange lighting, 9:16 vertical',
    characterPromptPrefixZh:
      '硬派科幻CG国漫角色设定图，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实织物与金属材质，柔和均匀的影棚光，中性浅灰纯色背景',
    characterPromptPrefixEn:
      'Hard sci-fi CG character sheet, cinematic 2.5D animation, realistic pilot suit and metallic armor details, soft studio light, neutral light-grey background',
    propPromptPrefixZh:
      '硬派科幻机械设定图，电影级2.5D硬表面渲染，单主体居中，真实金属磨损与结构细节，柔和影棚光，中性深灰纯色背景，无品牌标识',
    propPromptPrefixEn:
      'Hard sci-fi mecha/weapon design sheet, 2.5D hard-surface render, single centered object, weathered metal details, neutral dark-grey solid background',
    scenePromptPrefixZh:
      '硬派科幻场景概念图，电影级2.5D环境绘制，真实空间透视与尺度，无人物，9:16竖构图',
    scenePromptPrefixEn:
      'Hard sci-fi environment concept art, cinematic 2.5D render, massive scale and perspective, empty of people, 9:16 vertical',
    characterNegativePromptZh:
      '多余手指，五官扭曲，比例失调，Q版，卡通，真人实拍，塑料皮肤，磨皮滤镜，网红脸，锥子脸，欧式大双眼皮，美瞳，文字，水印，复杂背景',
    characterNegativePromptEn:
      'extra fingers, distorted face, chibi, cartoon, plastic skin, text, watermark, complex background',
    bibleSection3TitleZh:
      '星际体系（星域势力表、科技等级表、机甲等级表、驾驶员精神力等级表、金手指规则与限制）',
    bibleSection10TitleZh:
      '战力进度（逐集战力表：本集对手、机甲状态、胜负方式、损伤；机甲武器表含原理/视觉/音效/代价；敌方势力与兵种表）',
    bibleSection11TitleZh:
      '星图与空间（星域方位表、舰船与基地的舱室布局表、机甲格纳库尺寸与主要场景尺寸表）',
    episodeProgressTemplateZh: '本集对手｜机甲状态｜胜负方式｜损伤',
    pitfallRulesZh: [
      '人体与机甲尺度严格区分：机甲作为巨型道具（D卡 16:9 或 9:16）须标明精确米数（如18米高），同框时保持尺度悬殊',
      '机甲战损（装甲破损、断臂、过热）建立状态卡（LOOK-A/LOOK-B），未进格纳库维修前损伤不可自动复原',
      '驾驶舱内切与外部机甲动作遵循同一时间轴与受击方向，全息HUD用特效卡（FX纯黑底）后期合成，禁止直接让生图模型画乱码文字'
    ],
    forbidBrandLogos: true,
    keywords: [
      '星际',
      '机甲',
      '星舰',
      '虫族',
      '联邦',
      '帝国',
      '精神力',
      '驾驶舱',
      '激光',
      '曲率',
      '太空',
      '殖民星',
      '义体',
      '赛博',
      '科创'
    ]
  },
  {
    id: 'xitong-manju',
    category: 'fantasy',
    nameZh: '系统无限流',
    nameEn: 'System & Infinite Survival',
    audienceZh: '爽文闯关向',
    audienceEn: 'Dungeon Clearing & System Progression',
    shotCountRange: [32, 44],
    shotDurationRangeSec: [3, 9],
    dialogueCharsRange: [250, 450],
    visualStyleZh: '随副本切换的电影级2.5D国漫',
    visualStyleEn: 'Instance-adaptive cinematic 2.5D Chinese animation',
    videoStyleTagZh: '电影级2.5D国漫质感，成熟写实动漫比例，细腻五官与发丝，电影光影，9:16竖屏',
    videoStyleTagEn:
      'Cinematic 2.5D donghua texture, mature realistic proportions, detailed facial features, dramatic lighting, 9:16 vertical',
    characterPromptPrefixZh:
      '现代写实国漫角色设定图，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实服装面料，柔和均匀的影棚光，中性浅灰纯色背景',
    characterPromptPrefixEn:
      'Modern realistic 2.5D character sheet, mature proportions, detailed face and hair, authentic clothing fabric, soft studio light, neutral light-grey background',
    propPromptPrefixZh:
      '现代写实国漫道具设定图，电影级2.5D渲染质感，单主体居中，真实材质与使用痕迹，45度俯视，柔和影棚光，中性深灰纯色背景，无品牌标识',
    propPromptPrefixEn:
      'Modern realistic 2.5D prop sheet, single centered object, 45-degree top-down view, neutral dark-grey solid background, no brand logos',
    scenePromptPrefixZh:
      '现代写实国漫场景概念图，电影级2.5D环境绘制，真实空间透视与纵深，无人物，无品牌标识，9:16竖构图',
    scenePromptPrefixEn:
      'Modern realistic 2.5D environment concept art, realistic spatial depth, empty of people, no brand logos, 9:16 vertical',
    characterNegativePromptZh:
      '多余手指，五官扭曲，比例失调，Q版，卡通，真人实拍，塑料皮肤，磨皮滤镜，网红脸，锥子脸，欧式大双眼皮，美瞳，品牌标识，文字，水印，复杂背景',
    characterNegativePromptEn:
      'extra fingers, distorted face, chibi, cartoon, plastic skin, influencer face, brand logos, text, watermark, complex background',
    bibleSection3TitleZh:
      '系统规则（系统来源、任务与奖励规则表、属性与技能表、失败惩罚、核心谜团）',
    bibleSection10TitleZh:
      '通关进度（逐集通关表：所在副本、任务、属性变化、奖励、代价；技能道具表含视觉/音效/代价；副本总表含世界观/画风/规则）',
    bibleSection11TitleZh: '副本地图（每个副本的布局表、规则禁区表、主要场景尺寸表）',
    episodeProgressTemplateZh: '所在副本｜任务｜属性变化｜奖励｜代价',
    pitfallRulesZh: [
      '系统面板与倒计时数字一律不在生图/生视频提示词里直接生成文字，改用 FX01 纯黑底半透明几何光框 + 后期花字合成',
      '主角每集属性点、积分与道具栏加减账目必须严丝合缝，冷却时间与使用次数限制严格执行',
      '跨副本时主角面部一致性锚点（P01）保持不变，仅切换对应副本的服装卡（LOOK-A/LOOK-B）与副本场景色调'
    ],
    forbidBrandLogos: true,
    keywords: [
      '系统',
      '无限流',
      '副本',
      '闯关',
      '生存游戏',
      '主神',
      '任务',
      '奖励',
      '抹杀',
      '属性点',
      '规则怪谈',
      '惊悚游戏',
      '面板',
      '攻略'
    ]
  },
  {
    id: 'moshi-manju',
    category: 'fantasy',
    nameZh: '末日废土',
    nameEn: 'Post-Apocalyptic Wasteland',
    audienceZh: '男频或大女主爽文向',
    audienceEn: 'Survival & Wasteland Action',
    shotCountRange: [34, 46],
    shotDurationRangeSec: [3, 9],
    dialogueCharsRange: [250, 400],
    visualStyleZh: '废土写实国漫，电影级2.5D动画',
    visualStyleEn: 'Post-apocalyptic realistic Chinese animation, cinematic 2.5D',
    videoStyleTagZh:
      '废土写实国漫，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实磨损衣物与锈蚀金属，低饱和冷调，高反差电影光影，9:16竖屏',
    videoStyleTagEn:
      'Wasteland realistic 2.5D donghua, weathered clothing and rusted metal textures, desaturated cold palette, high-contrast cinematic lighting, 9:16 vertical',
    characterPromptPrefixZh:
      '废土写实国漫角色设定图，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实磨损的衣物与装备，柔和均匀的影棚光，中性浅灰纯色背景',
    characterPromptPrefixEn:
      'Wasteland realistic 2.5D character sheet, weathered survival gear and clothing, soft studio light, neutral light-grey solid background',
    propPromptPrefixZh:
      '废土写实国漫道具设定图，电影级2.5D渲染质感，单主体居中，真实磨损与锈蚀，45度俯视，柔和影棚光，中性深灰纯色背景，无品牌标识',
    propPromptPrefixEn:
      'Wasteland realistic 2.5D prop sheet, single centered object, authentic wear and rust, 45-degree top-down view, neutral dark-grey background, no brand logos',
    scenePromptPrefixZh:
      '废土写实国漫场景概念图，电影级2.5D环境绘制，真实空间透视与纵深，城市废墟，无人物，无品牌标识，无真实地标，9:16竖构图',
    scenePromptPrefixEn:
      'Wasteland realistic 2.5D environment concept art, urban ruins, empty of people, no brand logos or real landmarks, 9:16 vertical',
    characterNegativePromptZh:
      '多余手指，五官扭曲，比例失调，Q版，卡通，真人实拍，塑料皮肤，磨皮滤镜，网红脸，锥子脸，欧式大双眼皮，美瞳，品牌标识，断肢，内脏，文字，水印，复杂背景',
    characterNegativePromptEn:
      'extra fingers, distorted face, chibi, cartoon, plastic skin, brand logos, gore, dismemberment, text, watermark, complex background',
    bibleSection3TitleZh:
      '末世规则（灾变原因与时间线、丧尸或怪物分级表、异能体系表、安全屋/空间囤货金手指规则与限制）',
    bibleSection10TitleZh:
      '生存进度（逐集生存表：天数、地点、物资变化、人员变化、战力；物资总表；敌对势力表；主角招式或武器表）',
    bibleSection11TitleZh:
      '地图与空间（城市废墟与安全基地的方位布局表、基地各区功能表、主要场景尺寸表）',
    episodeProgressTemplateZh: '天数｜地点｜物资变化｜人员变化｜战力',
    pitfallRulesZh: [
      '物资消耗与补充必须记账：食物、净水、弹药、燃油随天数递减，禁止凭空多出物资',
      '人物服装污损与伤痕按灾变天数递进（LOOK-A 灾变前整洁 → LOOK-B 废土战损），禁止在废墟中穿一尘不染的新衣',
      '合规底线：严禁出现真实城市地标、真实品牌商标，严禁断肢与内脏外露特写（以黑影、剪影或飞溅尘土替代）'
    ],
    forbidBrandLogos: true,
    keywords: [
      '末日',
      '末世',
      '废土',
      '丧尸',
      '囤货',
      '安全屋',
      '庇护所',
      '极寒',
      '极热',
      '天灾',
      '异能',
      '变异',
      '物资',
      '基地',
      '尸潮'
    ]
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 二、古代题材（6 个）
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'chuanyue-manju',
    category: 'ancient',
    nameZh: '古代穿越重生',
    nameEn: 'Ancient Time-Travel & Rebirth',
    audienceZh: '大女主或爽文逆袭向',
    audienceEn: 'Female-lead / Reversal Historical Drama',
    shotCountRange: [28, 40],
    shotDurationRangeSec: [4, 10],
    dialogueCharsRange: [300, 500],
    visualStyleZh: '古风国漫，电影级2.5D动画',
    visualStyleEn: 'Classical Chinese style donghua, cinematic 2.5D',
    videoStyleTagZh:
      '古风国漫，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实织物、刺绣与木石材质，柔和电影光影，9:16竖屏',
    videoStyleTagEn:
      'Classical Chinese donghua, cinematic 2.5D animation texture, mature realistic proportions, authentic silk/embroidery/wood/stone materials, soft cinematic lighting, 9:16 vertical',
    characterPromptPrefixZh:
      '古风国漫角色设定图，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实织物与刺绣质感，柔和均匀的影棚光，中性浅灰纯色背景',
    characterPromptPrefixEn:
      'Classical Chinese 2.5D character sheet, authentic silk and embroidery textures, soft studio lighting, neutral light-grey solid background',
    propPromptPrefixZh:
      '古风国漫道具设定图，电影级2.5D渲染质感，单主体居中，真实材质与使用痕迹，45度俯视，柔和影棚光，中性深灰纯色背景',
    propPromptPrefixEn:
      'Classical Chinese 2.5D prop sheet, single centered object, 45-degree top-down view, neutral dark-grey solid background',
    scenePromptPrefixZh:
      '古风国漫场景概念图，电影级2.5D环境绘制，真实空间透视与纵深，无人物，9:16竖构图',
    scenePromptPrefixEn:
      'Classical Chinese 2.5D environment concept art, traditional architecture, empty of people, 9:16 vertical',
    characterNegativePromptZh:
      '多余手指，五官扭曲，比例失调，Q版，卡通，真人实拍，塑料皮肤，磨皮滤镜，网红脸，锥子脸，欧式大双眼皮，美瞳，浓妆，现代服饰，文字，水印，复杂背景',
    characterNegativePromptEn:
      'extra fingers, distorted face, chibi, cartoon, plastic skin, influencer face, modern clothing, text, watermark, complex background',
    bibleSection3TitleZh:
      '时代与身份体系（架空朝代设定、社会等级表、主角穿越前后的身份对照、金手指规则与限制）',
    bibleSection10TitleZh:
      '逆袭进度（逐集逆袭表：本集难题、用什么现代知识或先知解决、代价；知识卡牌表；对手手段表）',
    bibleSection11TitleZh: '地图与空间（主要府邸、城池、宫廷的方位布局表，主要场景尺寸表）',
    episodeProgressTemplateZh: '本集难题｜用什么现代知识或先知解决｜代价',
    pitfallRulesZh: [
      '架空朝代礼制、服制与称谓统一，现代知识落地必须符合古代原料与工艺条件，禁止凭空造出现代工业品',
      '主角身份与服饰演进（如落魄庶女 LOOK-A → 掌家主母 LOOK-B → 诰命夫人 LOOK-C）只进不退',
      '场景与道具严禁混入现代玻璃窗、塑料制品、现代简体印刷字或电灯光源'
    ],
    forbidModernItems: true,
    keywords: [
      '穿越',
      '古言',
      '王爷',
      '王妃',
      '世子',
      '庶女',
      '嫡女',
      '退婚',
      '休夫',
      '架空',
      '医妃',
      '神医',
      '侯府',
      '嫁妆'
    ]
  },
  {
    id: 'gongdou-manju',
    category: 'ancient',
    nameZh: '宫斗',
    nameEn: 'Imperial Palace Intrigue',
    audienceZh: '大女主向',
    audienceEn: 'Female-lead Palace Drama',
    shotCountRange: [24, 34],
    shotDurationRangeSec: [5, 12],
    dialogueCharsRange: [350, 550],
    visualStyleZh: '古风国漫，电影级2.5D动画',
    visualStyleEn: 'Imperial Chinese palace donghua, cinematic 2.5D',
    videoStyleTagZh:
      '古风国漫，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实织物、刺绣与木石材质，柔和电影光影，9:16竖屏',
    videoStyleTagEn:
      'Imperial Chinese palace 2.5D donghua, intricate embroidery and jade accessories, soft dramatic palace lighting, 9:16 vertical',
    characterPromptPrefixZh:
      '古风国漫角色设定图，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实织物与刺绣质感，柔和均匀的影棚光，中性浅灰纯色背景',
    characterPromptPrefixEn:
      'Imperial palace 2.5D character sheet, authentic silk embroidery and hairpins, soft studio lighting, neutral light-grey background',
    propPromptPrefixZh:
      '古风国漫道具设定图，电影级2.5D渲染质感，单主体居中，真实材质与使用痕迹，45度俯视，柔和影棚光，中性深灰纯色背景',
    propPromptPrefixEn:
      'Imperial palace 2.5D prop sheet, single centered object, 45-degree top-down view, neutral dark-grey solid background',
    scenePromptPrefixZh:
      '古风国漫场景概念图，电影级2.5D环境绘制，真实空间透视与纵深，无人物，9:16竖构图',
    scenePromptPrefixEn:
      'Imperial palace 2.5D environment concept art, grand palace halls and courtyards, empty of people, 9:16 vertical',
    characterNegativePromptZh:
      '多余手指，五官扭曲，比例失调，Q版，卡通，真人实拍，塑料皮肤，磨皮滤镜，网红脸，锥子脸，欧式大双眼皮，美瞳，现代服饰，文字，水印，复杂背景',
    characterNegativePromptEn:
      'extra fingers, distorted face, chibi, cartoon, plastic skin, influencer face, modern clothing, text, watermark, complex background',
    bibleSection3TitleZh:
      '宫廷体系（架空朝代设定、后宫位份表含服制颜色与首饰规制、宫规表、后宫派系表）',
    bibleSection10TitleZh:
      '势力消长（逐集势力表：主角位份、盟友、敌人、本集得失；计谋表：手段、破绽、谁看穿；信息差表）',
    bibleSection11TitleZh: '宫城地图（各宫殿方位布局表、居住者随位份的变动、主要场景尺寸表）',
    episodeProgressTemplateZh: '主角位份｜盟友｜敌人｜本集得失',
    pitfallRulesZh: [
      '后宫位份与服制头饰严格绑定：不同位份对应不同服装卡（LOOK-A 答应/常在 → LOOK-B 嫔/妃 → LOOK-C 贵妃/皇后），严禁越制穿正红或戴凤冠',
      '计谋必须有物证道具（D卡：香料、药渣、密信、护甲）并在镜头中给足特写铺垫，禁止纯靠口头宣布破局',
      '行礼规制与尊卑站位严格遵守宫规：高位者居主座或画中偏上，低位者居下首或侧立'
    ],
    forbidModernItems: true,
    keywords: [
      '宫斗',
      '后宫',
      '皇上',
      '太后',
      '皇后',
      '贵妃',
      '答应',
      '常在',
      '冷宫',
      '侍寝',
      '龙嗣',
      '凤印',
      '选秀',
      '嫔妃'
    ]
  },
  {
    id: 'zhaidou-manju',
    category: 'ancient',
    nameZh: '宅斗',
    nameEn: 'Aristocratic Family Intrigue',
    audienceZh: '大女主向',
    audienceEn: 'Female-lead Mansion Intrigue',
    shotCountRange: [26, 36],
    shotDurationRangeSec: [4, 11],
    dialogueCharsRange: [350, 550],
    visualStyleZh: '古风国漫，电影级2.5D动画',
    visualStyleEn: 'Classical mansion donghua, cinematic 2.5D',
    videoStyleTagZh:
      '古风国漫，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实织物、刺绣与木石材质，柔和电影光影，9:16竖屏',
    videoStyleTagEn:
      'Classical Chinese mansion 2.5D donghua, realistic silk and carved wood textures, soft cinematic lighting, 9:16 vertical',
    characterPromptPrefixZh:
      '古风国漫角色设定图，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实织物与刺绣质感，柔和均匀的影棚光，中性浅灰纯色背景',
    characterPromptPrefixEn:
      'Classical Chinese 2.5D character sheet, authentic silk and embroidery, soft studio lighting, neutral light-grey background',
    propPromptPrefixZh:
      '古风国漫道具设定图，电影级2.5D渲染质感，单主体居中，真实材质与使用痕迹，45度俯视，柔和影棚光，中性深灰纯色背景',
    propPromptPrefixEn:
      'Classical Chinese 2.5D prop sheet, single centered object, 45-degree top-down view, neutral dark-grey solid background',
    scenePromptPrefixZh:
      '古风国漫场景概念图，电影级2.5D环境绘制，真实空间透视与纵深，无人物，9:16竖构图',
    scenePromptPrefixEn:
      'Classical Chinese courtyard mansion 2.5D environment concept art, empty of people, 9:16 vertical',
    characterNegativePromptZh:
      '多余手指，五官扭曲，比例失调，Q版，卡通，真人实拍，塑料皮肤，磨皮滤镜，网红脸，锥子脸，欧式大双眼皮，美瞳，现代服饰，文字，水印，复杂背景',
    characterNegativePromptEn:
      'extra fingers, distorted face, chibi, cartoon, plastic skin, influencer face, modern clothing, text, watermark, complex background',
    bibleSection3TitleZh:
      '家族体系（架空朝代设定、家族关系树、嫡庶与房头表、管家权与财产账本表、称谓表）',
    bibleSection10TitleZh:
      '内宅权力变化（逐集权力表：主角掌握的人手、银钱、证据；计谋表：手段、破绽、反击；外部助力表）',
    bibleSection11TitleZh: '府邸地图（各院落的方位布局表、居住者、主要场景尺寸表）',
    episodeProgressTemplateZh: '主角掌握的人手｜银钱｜证据',
    pitfallRulesZh: [
      '嫡庶房头、辈分称谓、对牌钥匙与嫁妆账册（D卡）前后一致，银钱数目进出清晰',
      '各房院落（正院S01、偏院S02、祠堂S03）空间陈设等级分明，禁止串景'
    ],
    forbidModernItems: true,
    keywords: [
      '宅斗',
      '主母',
      '老夫人',
      '姨娘',
      '庶女',
      '嫡女',
      '掌家',
      '中馈',
      '祠堂',
      '嫁妆',
      '账本',
      '世家',
      '大房',
      '二房'
    ]
  },
  {
    id: 'quanmou-manju',
    category: 'ancient',
    nameZh: '权谋朝堂',
    nameEn: 'Imperial Court Political Intrigue',
    audienceZh: '权谋爽文向',
    audienceEn: 'Political Strategy & Court Drama',
    shotCountRange: [22, 32],
    shotDurationRangeSec: [5, 12],
    dialogueCharsRange: [350, 550],
    visualStyleZh: '古风国漫，电影级2.5D动画，沉稳厚重',
    visualStyleEn: 'Solemn classical Chinese political donghua, cinematic 2.5D',
    videoStyleTagZh:
      '古风国漫，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实织物、刺绣与木石材质，柔和电影光影，9:16竖屏',
    videoStyleTagEn:
      'Solemn classical Chinese 2.5D donghua, realistic official robes and wood/stone textures, dramatic low-key lighting, 9:16 vertical',
    characterPromptPrefixZh:
      '古风国漫角色设定图，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实织物与刺绣质感，柔和均匀的影棚光，中性浅灰纯色背景',
    characterPromptPrefixEn:
      'Classical Chinese court 2.5D character sheet, official robes and belt jade, soft studio light, neutral light-grey background',
    propPromptPrefixZh:
      '古风国漫道具设定图，电影级2.5D渲染质感，单主体居中，真实材质与使用痕迹，45度俯视，柔和影棚光，中性深灰纯色背景',
    propPromptPrefixEn:
      'Classical Chinese court 2.5D prop sheet, tiger tally/imperial edict/seal, single centered object, 45-degree top-down view, neutral dark-grey background',
    scenePromptPrefixZh:
      '古风国漫场景概念图，电影级2.5D环境绘制，真实空间透视与纵深，无人物，9:16竖构图',
    scenePromptPrefixEn:
      'Classical Chinese imperial court 2.5D environment concept art, grand halls and study rooms, empty of people, 9:16 vertical',
    characterNegativePromptZh:
      '多余手指，五官扭曲，比例失调，Q版，卡通，真人实拍，塑料皮肤，磨皮滤镜，网红脸，锥子脸，欧式大双眼皮，美瞳，现代服饰，文字，水印，复杂背景',
    characterNegativePromptEn:
      'extra fingers, distorted face, chibi, cartoon, plastic skin, influencer face, modern clothing, text, watermark, complex background',
    bibleSection3TitleZh: '朝堂体系（架空朝代设定、官制品级表、朝堂派系表、军政财三权的归属表）',
    bibleSection10TitleZh:
      '棋局进度（逐集棋局表：本集目标、布的局、谁入局、得失；计谋表：手段、破绽、反制；信息差表；各派实力消长表）',
    bibleSection11TitleZh: '地图与空间（都城与皇宫布局表、边关与封地方位表、主要场景尺寸表）',
    episodeProgressTemplateZh: '本集目标｜布的局｜谁入局｜得失',
    pitfallRulesZh: [
      '官服颜色、补子纹样与品级严格对应，升迁贬谪同步切换服装卡（LOOK-A/LOOK-B）',
      '每次博弈必须交代军权（虎符）、政权（诏书/廷议）、财权（盐铁/漕运）的真实筹码转移，禁止降智嘴炮'
    ],
    forbidModernItems: true,
    keywords: [
      '权谋',
      '朝堂',
      '太子',
      '皇子',
      '夺嫡',
      '宰相',
      '权臣',
      '锦衣卫',
      '虎符',
      '谋士',
      '藩王',
      '科举',
      '奏折',
      '帝王'
    ]
  },
  {
    id: 'wuxia-manju',
    category: 'ancient',
    nameZh: '武侠江湖',
    nameEn: 'Ink-Wash Wuxia Martial Arts',
    audienceZh: '武侠爽文向',
    audienceEn: 'Martial Arts & Jianghu Action',
    shotCountRange: [24, 36],
    shotDurationRangeSec: [3, 12],
    dialogueCharsRange: [200, 350],
    visualStyleZh: '水墨国漫，电影级2.5D动画',
    visualStyleEn: 'Ink-wash wuxia Chinese animation, cinematic 2.5D',
    videoStyleTagZh:
      '水墨国漫，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实织物与兵器材质，水墨晕染的留白，电影光影，9:16竖屏',
    videoStyleTagEn:
      'Ink-wash wuxia 2.5D donghua, mature realistic proportions, authentic fabric and cold steel weapons, subtle ink-wash atmosphere, cinematic lighting, 9:16 vertical',
    characterPromptPrefixZh:
      '水墨国漫角色设定图，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实织物与刺绣质感，柔和均匀的影棚光，中性浅灰纯色背景',
    characterPromptPrefixEn:
      'Ink-wash wuxia 2.5D character sheet, martial artist robes and weapon harness, soft studio light, neutral light-grey background',
    propPromptPrefixZh:
      '水墨国漫道具设定图，电影级2.5D渲染质感，单主体居中，真实材质与使用痕迹，45度俯视，柔和影棚光，中性深灰纯色背景',
    propPromptPrefixEn:
      'Ink-wash wuxia 2.5D weapon/prop sheet, single centered object, cold steel and scabbard details, 45-degree top-down view, neutral dark-grey background',
    scenePromptPrefixZh:
      '水墨国漫场景概念图，电影级2.5D环境绘制，真实空间透视与纵深，无人物，9:16竖构图',
    scenePromptPrefixEn:
      'Ink-wash wuxia 2.5D environment concept art, bamboo forest/tavern/mountain cliff, empty of people, 9:16 vertical',
    characterNegativePromptZh:
      '多余手指，五官扭曲，比例失调，Q版，卡通，真人实拍，塑料皮肤，磨皮滤镜，网红脸，锥子脸，欧式大双眼皮，美瞳，现代服饰，文字，水印，复杂背景',
    characterNegativePromptEn:
      'extra fingers, distorted face, chibi, cartoon, plastic skin, influencer face, modern clothing, text, watermark, complex background',
    bibleSection3TitleZh: '江湖体系（架空时代设定、门派势力表、武功层次表、江湖规矩表）',
    bibleSection10TitleZh:
      '武学进度（逐集武学表：本集对手、用什么招、胜负方式、伤势；主角武功表含原理/视觉/音效/代价；对手武功表）',
    bibleSection11TitleZh: '江湖地图（门派、城镇、险地的方位表，主要场景尺寸表）',
    episodeProgressTemplateZh: '本集对手｜用什么招｜胜负方式｜伤势',
    pitfallRulesZh: [
      '硬桥硬马武侠质感：招式讲究兵器碰撞、步伐借力与内劲震荡，禁止画成修仙激光对轰',
      '兵器（D卡）出鞘/入鞘/断刃状态与持握左右手在同场连续镜头中严禁跳变',
      '交手分镜图只画拔剑前对峙或收剑后的定格瞬间，出招拆招过程写在视频时间段内'
    ],
    forbidModernItems: true,
    keywords: [
      '武侠',
      '江湖',
      '少侠',
      '刀客',
      '剑客',
      '门派',
      '武林',
      '盟主',
      '秘籍',
      '内力',
      '轻功',
      '客栈',
      '镖局',
      '暗器'
    ]
  },
  {
    id: 'zhongtian-manju',
    category: 'ancient',
    nameZh: '古代种田经商',
    nameEn: 'Ancient Farming & Merchant Life',
    audienceZh: '女频治愈爽文向',
    audienceEn: 'Cozy Historical Farming & Business Progression',
    shotCountRange: [24, 34],
    shotDurationRangeSec: [4, 12],
    dialogueCharsRange: [300, 450],
    visualStyleZh: '暖色古风国漫，电影级2.5D动画',
    visualStyleEn: 'Warm pastoral classical Chinese donghua, cinematic 2.5D',
    videoStyleTagZh:
      '暖色古风国漫，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实布料、木器与食物质感，温暖柔和的光影，9:16竖屏',
    videoStyleTagEn:
      'Warm pastoral classical Chinese 2.5D donghua, authentic cloth/woodware/food textures, warm gentle sunlight, 9:16 vertical',
    characterPromptPrefixZh:
      '暖色古风国漫角色设定图，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实织物与刺绣质感，柔和均匀的影棚光，中性浅灰纯色背景',
    characterPromptPrefixEn:
      'Warm classical Chinese 2.5D character sheet, authentic cotton/linen/silk textures, soft studio lighting, neutral light-grey background',
    propPromptPrefixZh:
      '暖色古风国漫道具设定图，电影级2.5D渲染质感，单主体居中，真实材质与使用痕迹，45度俯视，柔和影棚光，中性深灰纯色背景',
    propPromptPrefixEn:
      'Warm classical Chinese 2.5D prop/food/tool sheet, single centered object, 45-degree top-down view, neutral dark-grey background',
    scenePromptPrefixZh:
      '暖色古风国漫场景概念图，电影级2.5D环境绘制，真实空间透视与纵深，无人物，温暖的生活气息，9:16竖构图',
    scenePromptPrefixEn:
      'Warm pastoral classical Chinese 2.5D environment concept art, lively village/shop/courtyard, empty of people, 9:16 vertical',
    characterNegativePromptZh:
      '多余手指，五官扭曲，比例失调，Q版，卡通，真人实拍，塑料皮肤，磨皮滤镜，网红脸，锥子脸，欧式大双眼皮，美瞳，现代服饰，文字，水印，复杂背景',
    characterNegativePromptEn:
      'extra fingers, distorted face, chibi, cartoon, plastic skin, influencer face, modern clothing, text, watermark, complex background',
    bibleSection3TitleZh:
      '生活体系（架空时代设定、家庭成员与家境表、当地物价换算表、主角手艺或金手指规则）',
    bibleSection10TitleZh:
      '发家进度（逐集发家表：本集难题、赚了多少、花了多少、资产变化；产业表：田地/铺子/商品；对手与极品亲戚阻力表）',
    bibleSection11TitleZh: '地图与空间（村庄、镇上铺子、家宅灶房的布局表，主要场景尺寸表）',
    episodeProgressTemplateZh: '本集难题｜赚了多少｜花了多少｜资产变化',
    pitfallRulesZh: [
      '铜钱、碎银、贯两物价换算前后严格统一，每集赚多少、花多少、余多少银钱账目必须算清',
      '主角衣着与气色随家境改善建立状态卡（LOOK-A 粗布补丁衣 → LOOK-B 细棉净衣 → LOOK-C 绸缎掌柜服），只进不退',
      '美食与手艺镜头在分镜图（A段）只画开工前食材摆放或出锅后的成品定格，切菜翻炒过程交给视频（B段）'
    ],
    forbidModernItems: true,
    keywords: [
      '种田',
      '经商',
      '发家',
      '致富',
      '逃荒',
      '猎户',
      '农女',
      '厨娘',
      '酒楼',
      '铺子',
      '极品亲戚',
      '分家',
      '赶海',
      '美食'
    ]
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 三、现代题材（8 个）
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'dushi-manju',
    category: 'modern',
    nameZh: '都市逆袭',
    nameEn: 'Urban Reversal & Counterattack',
    audienceZh: '男频爽文向',
    audienceEn: 'Urban Power Reversal & Face-Slapping Drama',
    shotCountRange: [38, 54],
    shotDurationRangeSec: [3, 8],
    dialogueCharsRange: [300, 500],
    visualStyleZh: '现代写实国漫，电影级2.5D动画',
    visualStyleEn: 'Modern realistic Chinese animation, cinematic 2.5D',
    videoStyleTagZh:
      '现代写实国漫，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实城市与室内材质，电影光影，9:16竖屏',
    videoStyleTagEn:
      'Modern realistic 2.5D donghua, mature proportions, detailed face and hair, authentic urban and interior materials, cinematic lighting, 9:16 vertical',
    characterPromptPrefixZh:
      '现代写实国漫角色设定图，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实服装面料，柔和均匀的影棚光，中性浅灰纯色背景',
    characterPromptPrefixEn:
      'Modern realistic 2.5D character turnaround sheet, authentic tailoring and fabric, soft studio light, neutral light-grey background',
    propPromptPrefixZh:
      '现代写实国漫道具设定图，电影级2.5D渲染质感，单主体居中，真实材质与使用痕迹，45度俯视，柔和影棚光，中性深灰纯色背景，无品牌标识',
    propPromptPrefixEn:
      'Modern realistic 2.5D prop sheet, single centered object, 45-degree top-down view, neutral dark-grey background, no brand logos',
    scenePromptPrefixZh:
      '现代写实国漫场景概念图，电影级2.5D环境绘制，真实空间透视与纵深，无人物，无品牌标识，9:16竖构图',
    scenePromptPrefixEn:
      'Modern realistic 2.5D urban environment concept art, empty of people, no brand logos, 9:16 vertical',
    characterNegativePromptZh:
      '多余手指，五官扭曲，比例失调，Q版，卡通，真人实拍，塑料皮肤，磨皮滤镜，网红脸，锥子脸，欧式大双眼皮，美瞳，品牌标识，文字，水印，复杂背景',
    characterNegativePromptEn:
      'extra fingers, distorted face, chibi, cartoon, live-action photo, plastic skin, influencer face, brand logos, text, watermark, complex background',
    bibleSection3TitleZh:
      '身份体系（主角明暗身份表、社会层级表、金手指规则与限制、身份揭露节奏表）',
    bibleSection10TitleZh:
      '打脸节奏（逐集打脸表：谁看不起主角、怎么打脸、露出哪层身份；对手层级表：从小人到幕后；主角资源表：人脉/资金/技能）',
    bibleSection11TitleZh: '地点与空间（城市主要地点的方位表，主要场景尺寸表）',
    episodeProgressTemplateZh: '谁看不起主角｜怎么打脸｜露出哪层身份',
    pitfallRulesZh: [
      '主角隐藏身份分层揭露（不能第1集就把底牌全掀完），每次亮出信物（D卡：黑卡、印章、勋章）须与对应层级大佬的反应匹配',
      '严禁出现真实车标、奢侈品Logo、真实银行或企业名称，全部使用原创虚构徽标',
      '未揭晓身份的幕后大人物出场只用「背影卡」或局部特写，揭晓当集才切换正式正脸卡'
    ],
    forbidBrandLogos: true,
    keywords: [
      '都市',
      '逆袭',
      '神豪',
      '战神',
      '龙王',
      '赘婿',
      '首富',
      '打脸',
      '黑卡',
      '保安',
      '外卖',
      '隐藏身份',
      '前妻',
      '拍卖会'
    ]
  },
  {
    id: 'tianchong-manju',
    category: 'modern',
    nameZh: '总裁甜宠',
    nameEn: 'CEO Romance & Sweet Drama',
    audienceZh: '女频甜宠向',
    audienceEn: 'Female-oriented Modern Romance',
    shotCountRange: [28, 42],
    shotDurationRangeSec: [4, 12],
    dialogueCharsRange: [300, 450],
    visualStyleZh: '现代精致国漫，电影级2.5D动画',
    visualStyleEn: 'Modern refined romance donghua, cinematic 2.5D',
    videoStyleTagZh:
      '现代精致国漫，电影级2.5D动画质感，精致写实动漫比例，细腻五官与发丝，柔和电影光影，暖色调，9:16竖屏',
    videoStyleTagEn:
      'Modern refined 2.5D romance donghua, delicate facial features and hair strands, warm romantic cinematic lighting, 9:16 vertical',
    characterPromptPrefixZh:
      '现代精致国漫角色设定图，电影级2.5D动画质感，精致写实动漫比例，细腻五官与发丝，真实服装面料，柔和均匀的影棚光，中性浅灰纯色背景',
    characterPromptPrefixEn:
      'Modern refined 2.5D romance character sheet, elegant fashion and tailoring, soft studio lighting, neutral light-grey background',
    propPromptPrefixZh:
      '现代精致国漫道具设定图，电影级2.5D渲染质感，单主体居中，真实材质与使用痕迹，45度俯视，柔和影棚光，中性深灰纯色背景，无品牌标识',
    propPromptPrefixEn:
      'Modern refined 2.5D prop sheet, single centered object, 45-degree top-down view, neutral dark-grey background, no brand logos',
    scenePromptPrefixZh:
      '现代精致国漫场景概念图，电影级2.5D环境绘制，真实空间透视与纵深，无人物，无品牌标识，9:16竖构图',
    scenePromptPrefixEn:
      'Modern refined 2.5D environment concept art, warm luxury interior/cityscape, empty of people, no brand logos, 9:16 vertical',
    characterNegativePromptZh:
      '多余手指，五官扭曲，比例失调，Q版，卡通，真人实拍，塑料皮肤，磨皮滤镜，网红脸，锥子脸，欧式大双眼皮，美瞳，品牌标识，文字，水印，复杂背景',
    characterNegativePromptEn:
      'extra fingers, distorted face, chibi, cartoon, plastic skin, influencer face, brand logos, text, watermark, complex background',
    bibleSection3TitleZh:
      '关系设定（男女主身份差与身高差、相遇契机、契约或婚姻规则、双方的秘密与心结）',
    bibleSection10TitleZh:
      '感情进度（逐集感情表：本集甜点、误会或阻碍、关系前进了哪一步；甜点名场面清单；情敌与阻力表）',
    bibleSection11TitleZh: '地点与空间（同居别墅、公司总裁办、约会地点的布局表，主要场景尺寸表）',
    episodeProgressTemplateZh: '本集甜点｜误会或阻碍｜关系前进了哪一步',
    pitfallRulesZh: [
      '男女主最萌身高差（如男主188cm、女主165cm）在同框镜头中必须严格体现视线倾角（男主微俯视、女主微仰视）',
      '肢体接触（拥抱、壁咚、牵手）在分镜图（A段）只画接触完成后的稳定定格姿势，靠近过程写在视频（B段），严禁双人手指穿模',
      '每集必须有明确的感情递进与甜点名场面，误会不过夜或当集给出反击爽点'
    ],
    forbidBrandLogos: true,
    keywords: [
      '甜宠',
      '总裁',
      '霸总',
      '闪婚',
      '契约婚姻',
      '先婚后爱',
      '暗恋',
      '宠妻',
      '小娇妻',
      '萌宝',
      '带球跑',
      '白月光',
      '替身'
    ]
  },
  {
    id: 'jiating-manju',
    category: 'modern',
    nameZh: '家庭伦理',
    nameEn: 'Realistic Family Ethics Drama',
    audienceZh: '女性家庭向',
    audienceEn: 'Realistic Chinese Family & Marriage Drama',
    shotCountRange: [22, 32],
    shotDurationRangeSec: [5, 14],
    dialogueCharsRange: [400, 600],
    visualStyleZh: '中国现实主义家庭片，真人写实电影质感',
    visualStyleEn: 'Chinese realistic family cinema, live-action photorealistic film texture',
    videoStyleTagZh:
      '现代中国城市题材，中国现实主义家庭电影风格，真人电影级实拍，低饱和写实配色，冷暖色调对比，柔和细腻的真实电影光影，35mm电影镜头质感，浅景深，轻微胶片颗粒，自然皮肤纹理与生活细节，9:16竖屏',
    videoStyleTagEn:
      'Modern Chinese urban family drama, photorealistic live-action cinema style, desaturated realistic palette, 35mm film lens texture, shallow depth of field, subtle film grain, natural skin texture, 9:16 vertical',
    characterPromptPrefixZh:
      '真人写实摄影风格，家庭短剧角色立绘，真实人像质感，真实皮肤纹理，自然光影，中性米白纯色背景',
    characterPromptPrefixEn:
      'Photorealistic portrait photography, Chinese family drama character sheet, natural skin pores and texture, natural lighting, neutral warm-white solid background',
    propPromptPrefixZh:
      '真人写实风格，道具摄影图，单主体居中，真实材质与使用痕迹，45度俯视，柔光，白色纯色背景，无品牌标识',
    propPromptPrefixEn:
      'Photorealistic product photography, single centered prop, authentic daily use wear, 45-degree top-down view, soft light, solid white background, no brand logos',
    scenePromptPrefixZh:
      '真人写实风格，家庭短剧场景摄影图，真实生活痕迹，无人物，无品牌标识，9:16竖构图',
    scenePromptPrefixEn:
      'Photorealistic Chinese apartment interior photography, lived-in details, empty of people, no brand logos, 9:16 vertical',
    characterNegativePromptZh:
      '动漫感，卡通感，CG渲染感，塑料皮肤，磨皮滤镜，网红脸，多余手指，五官扭曲，模糊，文字，水印，面容前后不一致',
    characterNegativePromptEn:
      'anime, cartoon, CG render, plastic skin, airbrushed filter, influencer face, extra fingers, distorted face, text, watermark, inconsistent facial features',
    bibleSection3TitleZh: '家庭关系（家庭关系树、每个人的软肋与欲望、房产与存款金钱状况表）',
    bibleSection10TitleZh:
      '证据与反转（逐集矛盾表：谁出招、主角怎么接、谁占上风；证据链表：证据是什么、何时拿到、何时亮出；反转表）',
    bibleSection11TitleZh:
      '家的空间（家庭住宅的户型布局表、客厅/主卧/次卧/厨房动线、主要场景尺寸表）',
    episodeProgressTemplateZh: '谁出招｜主角怎么接｜谁占上风｜亮出了什么证据',
    pitfallRulesZh: [
      '本题材默认采用「真人写实电影质感」，严禁出现动漫/CG塑料感，全角色保持真实生活化面容与衣着',
      '房产证、转账记录、行车记录仪、录音笔等核心证据（D卡）何时取得、藏于何处、何时亮出必须构成闭环',
      '家庭住宅户型（客厅沙发朝向、餐桌位置、房门开合方向）全季锁死，禁止前后集门窗换位'
    ],
    forbidBrandLogos: true,
    keywords: [
      '家庭',
      '伦理',
      '婆媳',
      '婚姻',
      '出轨',
      '离婚',
      '房产证',
      '彩礼',
      '养老',
      '偏心',
      '原生家庭',
      '丈母娘',
      '婆婆',
      '扶弟魔'
    ]
  },
  {
    id: 'chongsheng-manju',
    category: 'modern',
    nameZh: '现代重生复仇',
    nameEn: 'Modern Rebirth & Revenge',
    audienceZh: '爽文复仇向',
    audienceEn: 'Modern Rebirth Counterattack Drama',
    shotCountRange: [32, 44],
    shotDurationRangeSec: [3, 9],
    dialogueCharsRange: [300, 500],
    visualStyleZh: '现代写实国漫，电影级2.5D动画',
    visualStyleEn: 'Modern realistic Chinese animation, cinematic 2.5D',
    videoStyleTagZh:
      '现代写实国漫，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实城市与室内材质，电影光影，9:16竖屏',
    videoStyleTagEn:
      'Modern realistic 2.5D donghua, mature proportions, detailed facial features and hair, authentic urban and interior textures, cinematic lighting, 9:16 vertical',
    characterPromptPrefixZh:
      '现代写实国漫角色设定图，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实服装面料，柔和均匀的影棚光，中性浅灰纯色背景',
    characterPromptPrefixEn:
      'Modern realistic 2.5D character sheet, authentic clothing fabric, soft studio light, neutral light-grey background',
    propPromptPrefixZh:
      '现代写实国漫道具设定图，电影级2.5D渲染质感，单主体居中，真实材质与使用痕迹，45度俯视，柔和影棚光，中性深灰纯色背景，无品牌标识',
    propPromptPrefixEn:
      'Modern realistic 2.5D prop sheet, single centered object, 45-degree top-down view, neutral dark-grey background, no brand logos',
    scenePromptPrefixZh:
      '现代写实国漫场景概念图，电影级2.5D环境绘制，真实空间透视与纵深，无人物，无品牌标识，9:16竖构图',
    scenePromptPrefixEn:
      'Modern realistic 2.5D environment concept art, empty of people, no brand logos, 9:16 vertical',
    characterNegativePromptZh:
      '多余手指，五官扭曲，比例失调，Q版，卡通，真人实拍，塑料皮肤，磨皮滤镜，网红脸，锥子脸，欧式大双眼皮，美瞳，品牌标识，文字，水印，复杂背景',
    characterNegativePromptEn:
      'extra fingers, distorted face, chibi, cartoon, plastic skin, influencer face, brand logos, text, watermark, complex background',
    bibleSection3TitleZh:
      '重生规则（重生时间点、前世结局、前世时间线表、今生改变点表、金手指规则与限制）',
    bibleSection10TitleZh:
      '复仇进度（逐集复仇表：本集目标、用了哪条前世记忆、对手损失；仇人清单与结局；先知清单：记得的事件/发生时间/怎么利用）',
    bibleSection11TitleZh: '地点与空间（公司、家、宴会厅等主要地点的布局表，主要场景尺寸表）',
    episodeProgressTemplateZh: '本集目标｜用了哪条前世记忆｜对手损失',
    pitfallRulesZh: [
      '双色调定调：今生正常色调使用 STYLE01，前世闪回低饱和冷调使用 STYLE02，并在人物状态卡区分前世憔悴（LOOK-A）与今生锋芒（LOOK-B）',
      '前世今生蝴蝶效应：主角改变过去后，后续事件须发生合理偏移，中后段必须出现先知失灵与更高维度的博弈',
      '每个仇人的倒台必须有完整证据链与因果报应，禁止无脑口头秒杀'
    ],
    forbidBrandLogos: true,
    keywords: [
      '重生',
      '前世',
      '上一世',
      '复仇',
      '回到',
      '悔婚',
      '白眼狼',
      '假千金',
      '真千金',
      '断绝关系',
      '偏心父母',
      '死前',
      '重活一世'
    ]
  },
  {
    id: 'shangzhan-manju',
    category: 'modern',
    nameZh: '职场商战',
    nameEn: 'Corporate & Business Warfare',
    audienceZh: '都市职场爽文向',
    audienceEn: 'Corporate Strategy & Workplace Counterattack',
    shotCountRange: [26, 36],
    shotDurationRangeSec: [4, 10],
    dialogueCharsRange: [350, 550],
    visualStyleZh: '现代写实国漫，电影级2.5D动画',
    visualStyleEn: 'Modern corporate realistic donghua, cinematic 2.5D',
    videoStyleTagZh:
      '现代写实国漫，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实城市与室内材质，电影光影，9:16竖屏',
    videoStyleTagEn:
      'Modern corporate realistic 2.5D donghua, sharp tailoring, glass and steel office interiors, cinematic lighting, 9:16 vertical',
    characterPromptPrefixZh:
      '现代写实国漫角色设定图，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实服装面料，柔和均匀的影棚光，中性浅灰纯色背景',
    characterPromptPrefixEn:
      'Modern corporate 2.5D character sheet, business attire and sharp tailoring, soft studio light, neutral light-grey background',
    propPromptPrefixZh:
      '现代写实国漫道具设定图，电影级2.5D渲染质感，单主体居中，真实材质与使用痕迹，45度俯视，柔和影棚光，中性深灰纯色背景，无品牌标识',
    propPromptPrefixEn:
      'Modern corporate 2.5D prop sheet, contract/seal/prototype, single centered object, 45-degree top-down view, neutral dark-grey background, no brand logos',
    scenePromptPrefixZh:
      '现代写实国漫场景概念图，电影级2.5D环境绘制，真实空间透视与纵深，无人物，无品牌标识，9:16竖构图',
    scenePromptPrefixEn:
      'Modern corporate 2.5D office/boardroom concept art, empty of people, no brand logos, 9:16 vertical',
    characterNegativePromptZh:
      '多余手指，五官扭曲，比例失调，Q版，卡通，真人实拍，塑料皮肤，磨皮滤镜，网红脸，锥子脸，欧式大双眼皮，美瞳，品牌标识，文字，水印，复杂背景',
    characterNegativePromptEn:
      'extra fingers, distorted face, chibi, cartoon, plastic skin, influencer face, brand logos, text, watermark, complex background',
    bibleSection3TitleZh:
      '公司体系（公司组织架构表、股权比例表、行业背景与核心技术、主角的能力或底牌筹码）',
    bibleSection10TitleZh:
      '筹码进度（逐集筹码表：本集交锋、主角与对手的筹码变化；核心项目表；反转表；对手手段表）',
    bibleSection11TitleZh:
      '地点与空间（开放办公区、董事会议室、实验室等主要地点的布局表与座位尊卑表，主要场景尺寸表）',
    episodeProgressTemplateZh: '本集交锋｜主角筹码变化｜对手筹码变化',
    pitfallRulesZh: [
      '股权比例（总和100%）、合同条款、竞标底价与项目周期必须符合商业常识，每次反转靠底牌筹码与合同漏洞而非喊口号',
      '会议室座位轴线固定：董事长居主位，博弈双方分坐长桌两侧（画左/画右锁定），严禁正反打跳轴'
    ],
    forbidBrandLogos: true,
    keywords: [
      '商战',
      '职场',
      '董事会',
      '股权',
      '收购',
      '做空',
      '竞标',
      '裁员',
      '空降',
      '高管',
      '专利',
      '合伙人',
      '上市',
      '公关'
    ]
  },
  {
    id: 'niandai-manju',
    category: 'modern',
    nameZh: '年代文',
    nameEn: 'Period Nostalgia (1970s–1990s)',
    audienceZh: '女频年代向',
    audienceEn: 'Period Family & Entrepreneurial Drama',
    shotCountRange: [22, 32],
    shotDurationRangeSec: [5, 13],
    dialogueCharsRange: [300, 450],
    visualStyleZh: '年代胶片感国漫，电影级2.5D动画',
    visualStyleEn: 'Vintage film-grain period Chinese animation, cinematic 2.5D',
    videoStyleTagZh:
      '年代胶片感国漫，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实布料与旧物质感，暖黄褪色色调，轻微胶片颗粒，9:16竖屏',
    videoStyleTagEn:
      'Vintage period 2.5D donghua, authentic cotton/enamel/old wood textures, warm faded nostalgia color grading, subtle film grain, 9:16 vertical',
    characterPromptPrefixZh:
      '年代胶片感国漫角色设定图，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实服装面料，柔和均匀的影棚光，中性浅灰纯色背景',
    characterPromptPrefixEn:
      'Vintage period 2.5D character sheet, 1970s-1990s Chinese clothing and hairstyle, soft studio light, neutral light-grey background',
    propPromptPrefixZh:
      '年代胶片感国漫道具设定图，电影级2.5D渲染质感，单主体居中，真实材质与使用痕迹，45度俯视，柔和影棚光，中性深灰纯色背景，无品牌标识',
    propPromptPrefixEn:
      'Vintage period 2.5D prop sheet, enamel mug/ration coupon/vintage bicycle, single centered object, 45-degree top-down view, neutral dark-grey background',
    scenePromptPrefixZh:
      '年代胶片感国漫场景概念图，电影级2.5D环境绘制，真实空间透视与纵深，无人物，无品牌标识，9:16竖构图',
    scenePromptPrefixEn:
      'Vintage period 2.5D environment concept art, factory compound/state-owned store/courtyard, empty of people, 9:16 vertical',
    characterNegativePromptZh:
      '多余手指，五官扭曲，比例失调，Q版，卡通，真人实拍，塑料皮肤，磨皮滤镜，网红脸，锥子脸，欧式大双眼皮，美瞳，现代电子产品，现代服饰，品牌标识，文字，水印，复杂背景',
    characterNegativePromptEn:
      'extra fingers, distorted face, chibi, cartoon, plastic skin, influencer face, smartphones, modern electronics, modern clothing, brand logos, text, watermark',
    bibleSection3TitleZh:
      '时代背景（具体年代设定、当时的工资物价与票证表、家庭与厂矿单位关系表、主角的金手指）',
    bibleSection10TitleZh:
      '奋斗进度（逐集进度表：年份、本集难题、收入变化、家庭处境；个体户/产业表；对手与阻力表）',
    bibleSection11TitleZh: '地图与空间（村庄、县城供销社、厂矿家属院的布局表，主要场景尺寸表）',
    episodeProgressTemplateZh: '年份｜本集难题｜收入变化｜家庭处境',
    pitfallRulesZh: [
      '物价与票证必须符合所在年代（如70年代几毛钱一斤肉、凭布票粮票购买，80年代万元户），严禁出现万元月薪或现代网购词汇',
      '严禁穿帮：画面与道具中绝对禁止出现智能手机、液晶电视、现代铝合金门窗、现代汽车与网红妆容'
    ],
    forbidBrandLogos: true,
    forbidModernItems: true,
    keywords: [
      '年代',
      '七零',
      '八零',
      '九零',
      '70年代',
      '80年代',
      '知青',
      '下乡',
      '供销社',
      '粮票',
      '布票',
      '家属院',
      '军婚',
      '厂长',
      '个体户',
      '高考'
    ]
  },
  {
    id: 'yule-manju',
    category: 'modern',
    nameZh: '娱乐圈',
    nameEn: 'Showbiz & Entertainment Star',
    audienceZh: '女频或爽文向',
    audienceEn: 'Showbiz Comeback & Star Progression',
    shotCountRange: [34, 46],
    shotDurationRangeSec: [3, 8],
    dialogueCharsRange: [300, 500],
    visualStyleZh: '现代精致国漫，电影级2.5D动画',
    visualStyleEn: 'Glamorous modern showbiz donghua, cinematic 2.5D',
    videoStyleTagZh:
      '现代精致国漫，电影级2.5D动画质感，精致写实动漫比例，细腻五官与发丝，真实服装与舞台灯光，电影光影，9:16竖屏',
    videoStyleTagEn:
      'Modern showbiz 2.5D donghua, haute couture fabrics and stage lighting, cinematic depth, 9:16 vertical',
    characterPromptPrefixZh:
      '现代精致国漫角色设定图，电影级2.5D动画质感，精致写实动漫比例，细腻五官与发丝，真实服装面料，柔和均匀的影棚光，中性浅灰纯色背景',
    characterPromptPrefixEn:
      'Modern showbiz 2.5D character sheet, red-carpet/stage fashion, soft studio lighting, neutral light-grey background',
    propPromptPrefixZh:
      '现代精致国漫道具设定图，电影级2.5D渲染质感，单主体居中，真实材质与使用痕迹，45度俯视，柔和影棚光，中性深灰纯色背景，无品牌标识',
    propPromptPrefixEn:
      'Modern showbiz 2.5D prop sheet, trophy/script/microphone, single centered object, 45-degree top-down view, neutral dark-grey background, no brand logos',
    scenePromptPrefixZh:
      '现代精致国漫场景概念图，电影级2.5D环境绘制，真实空间透视与纵深，无人物，无品牌标识，9:16竖构图',
    scenePromptPrefixEn:
      'Modern showbiz 2.5D environment concept art, film set/red carpet/recording studio, empty of people, no brand logos, 9:16 vertical',
    characterNegativePromptZh:
      '多余手指，五官扭曲，比例失调，Q版，卡通，真人实拍，塑料皮肤，磨皮滤镜，网红脸，锥子脸，欧式大双眼皮，美瞳，品牌标识，文字，水印，复杂背景',
    characterNegativePromptEn:
      'extra fingers, distorted face, chibi, cartoon, plastic skin, influencer face, brand logos, text, watermark, complex background',
    bibleSection3TitleZh: '行业体系（经纪公司与资本派系表、艺人咖位层级表、主角的处境与金手指）',
    bibleSection10TitleZh:
      '声量进度（逐集声量表：本集事件、舆论走向、粉丝和口碑变化；代表作品表；黑料澄清与反转表；对手手段表）',
    bibleSection11TitleZh:
      '地点与空间（片场、综艺录制现场、红毯、经纪公司的布局表，主要场景尺寸表）',
    episodeProgressTemplateZh: '本集事件｜舆论走向｜粉丝和口碑变化',
    pitfallRulesZh: [
      '全部使用原创角色名与虚构综艺/影视剧名，严禁影射真实明星或使用真人明星脸',
      '戏中戏（片场拍戏）与现实片场须通过服装卡（LOOK-A 日常私服 vs LOOK-B 戏服/红毯高定）和环境光冷暖明确区分',
      '弹幕与热搜词条不在生图/生视频中直接生成文字，统一放入制作信息由后期花字合成'
    ],
    forbidBrandLogos: true,
    keywords: [
      '娱乐圈',
      '明星',
      '影后',
      '影帝',
      '顶流',
      '选秀',
      '综艺',
      '塌房',
      '热搜',
      '经纪人',
      '试镜',
      '红毯',
      '狗仔',
      '封杀',
      '复出'
    ]
  },
  {
    id: 'xiaoyuan-manju',
    category: 'modern',
    nameZh: '大学校园青春',
    nameEn: 'University Campus Youth & Romance',
    audienceZh: '青春恋爱向',
    audienceEn: 'University Youth & Growth Romance',
    shotCountRange: [22, 30],
    shotDurationRangeSec: [5, 13],
    dialogueCharsRange: [220, 380],
    visualStyleZh: '清新国漫，电影级2.5D动画',
    visualStyleEn: 'Fresh youth Chinese animation, cinematic 2.5D',
    videoStyleTagZh:
      '清新国漫，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，柔和明亮的自然光，清新配色，9:16竖屏',
    videoStyleTagEn:
      'Fresh youth 2.5D donghua, mature realistic university student proportions, bright natural sunlight, clean pastel palette, 9:16 vertical',
    characterPromptPrefixZh:
      '清新国漫角色设定图，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实服装面料，柔和均匀的影棚光，中性浅灰纯色背景',
    characterPromptPrefixEn:
      'Fresh youth 2.5D character sheet, university student casual fashion (18+ adult proportions), soft studio light, neutral light-grey background',
    propPromptPrefixZh:
      '清新国漫道具设定图，电影级2.5D渲染质感，单主体居中，真实材质与使用痕迹，45度俯视，柔和影棚光，中性深灰纯色背景，无品牌标识',
    propPromptPrefixEn:
      'Fresh youth 2.5D prop sheet, single centered object, 45-degree top-down view, neutral dark-grey background, no brand logos',
    scenePromptPrefixZh:
      '清新国漫场景概念图，电影级2.5D环境绘制，真实空间透视与纵深，无人物，无品牌标识，9:16竖构图',
    scenePromptPrefixEn:
      'Fresh youth 2.5D university campus environment concept art, library/lecture hall/sports field, empty of people, no brand logos, 9:16 vertical',
    characterNegativePromptZh:
      '多余手指，五官扭曲，比例失调，Q版，卡通，真人实拍，塑料皮肤，磨皮滤镜，网红脸，锥子脸，欧式大双眼皮，美瞳，品牌标识，文字，水印，复杂背景，幼态，校服',
    characterNegativePromptEn:
      'extra fingers, distorted face, chibi, cartoon, plastic skin, influencer face, brand logos, text, watermark, complex background, underage, middle-school uniform',
    bibleSection3TitleZh:
      '校园设定（虚构大学背景、院系与社团表、人物关系表；所有主要人物均为18岁以上的成年大学生）',
    bibleSection10TitleZh:
      '成长进度（逐集进度表：本集事件、感情进展、个人成长；甜点与遗憾清单；竞赛或学业阻力表）',
    bibleSection11TitleZh:
      '地点与空间（大学校园地图、宿舍、阶梯教室、社团活动室的布局表，主要场景尺寸表）',
    episodeProgressTemplateZh: '本集事件｜感情进展｜个人成长',
    pitfallRulesZh: [
      '合规红线：所有角色严格设定为18岁以上成年大学生（外貌描述写明青年成年体态，穿大学日常穿搭，严禁出现中小学校服与幼态描写）',
      '情感细腻自然，多用眼神、光影变化与小道具（D卡：借书卡、社团徽章、雨伞）传递情绪'
    ],
    forbidBrandLogos: true,
    keywords: [
      '大学',
      '校园',
      '校草',
      '校花',
      '学长',
      '学姐',
      '社团',
      '宿舍',
      '室友',
      '图书馆',
      '篮球场',
      '迎新',
      '辩论赛',
      '青春'
    ]
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 四、类型片题材（2 个）
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'xuanyi-manju',
    category: 'genre',
    nameZh: '悬疑刑侦',
    nameEn: 'Suspense & Crime Investigation',
    audienceZh: '悬疑推理向',
    audienceEn: 'Crime Mystery & Detective Thriller',
    shotCountRange: [24, 36],
    shotDurationRangeSec: [4, 12],
    dialogueCharsRange: [300, 500],
    visualStyleZh: '冷调写实国漫，电影级2.5D动画',
    visualStyleEn: 'Cold-tone noir realistic Chinese animation, cinematic 2.5D',
    videoStyleTagZh:
      '冷调写实国漫，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实城市与室内材质，低饱和冷调，高反差电影光影，9:16竖屏',
    videoStyleTagEn:
      'Cold-tone realistic 2.5D crime donghua, mature proportions, desaturated noir palette, high-contrast chiaroscuro lighting, 9:16 vertical',
    characterPromptPrefixZh:
      '冷调写实国漫角色设定图，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实服装面料，柔和均匀的影棚光，中性浅灰纯色背景',
    characterPromptPrefixEn:
      'Cold-tone realistic 2.5D character sheet, detective/suspect attire, soft studio light, neutral light-grey background',
    propPromptPrefixZh:
      '冷调写实国漫道具设定图，电影级2.5D渲染质感，单主体居中，真实材质与使用痕迹，45度俯视，柔和影棚光，中性深灰纯色背景，无品牌标识',
    propPromptPrefixEn:
      'Cold-tone realistic 2.5D evidence prop sheet, single centered object, 45-degree top-down view, neutral dark-grey background, no brand logos',
    scenePromptPrefixZh:
      '冷调写实国漫场景概念图，电影级2.5D环境绘制，真实空间透视与纵深，无人物，无品牌标识，9:16竖构图',
    scenePromptPrefixEn:
      'Cold-tone realistic 2.5D crime scene/interrogation room concept art, empty of people, no brand logos, 9:16 vertical',
    characterNegativePromptZh:
      '多余手指，五官扭曲，比例失调，Q版，卡通，真人实拍，塑料皮肤，磨皮滤镜，网红脸，锥子脸，欧式大双眼皮，美瞳，品牌标识，遗体，伤口特写，文字，水印，复杂背景',
    characterNegativePromptEn:
      'extra fingers, distorted face, chibi, cartoon, plastic skin, influencer face, brand logos, corpse, open wound close-up, text, watermark, complex background',
    bibleSection3TitleZh:
      '案件体系（虚构城市设定、主案与分案表、人物嫌疑与不在场证明表、主角的侦查方式）',
    bibleSection10TitleZh:
      '线索进度（逐集线索表：本集线索、指向谁、误导还是真相；案发当日分钟级时间线表；反转表；证言真假对照表）',
    bibleSection11TitleZh:
      '案发空间（案发现场的详细平面布局表、门窗锁具与视线死角表、主要场景尺寸表）',
    episodeProgressTemplateZh: '本集线索｜指向谁｜误导还是真相',
    pitfallRulesZh: [
      '公平推理与分钟级时间线：所有破案关键物证（D卡）必须在前面集数的画面中真实出现过，严禁结局凭空掏出新证据',
      '真凶揭晓前只用「背影卡」（Pxx_背影）或阴影遮挡，严禁提前暴露真凶正脸卡或同款独特配饰',
      '合规底线：虚构城市与纯属虚构的办案机构，严禁直接画遗体与血腥伤口特写（用警戒线、粉笔轮廓、带血证物或目击者惊恐反应镜头代替）'
    ],
    forbidBrandLogos: true,
    keywords: [
      '悬疑',
      '刑侦',
      '破案',
      '凶手',
      '真凶',
      '不在场证明',
      '密室',
      '法医',
      '审讯',
      '证物',
      '连环案',
      '线索',
      '推理',
      '目击'
    ]
  },
  {
    id: 'minsu-manju',
    category: 'genre',
    nameZh: '民俗怪谈',
    nameEn: 'Folklore Mystery & Weird Tales',
    audienceZh: '悬疑猎奇向',
    audienceEn: 'Folklore Suspense & Investigation',
    shotCountRange: [22, 30],
    shotDurationRangeSec: [5, 14],
    dialogueCharsRange: [200, 350],
    visualStyleZh: '暗调民俗国漫，电影级2.5D动画',
    visualStyleEn: 'Dark folklore Chinese animation, cinematic 2.5D',
    videoStyleTagZh:
      '暗调民俗国漫，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实木石与粗布质感，低饱和阴郁色调，电影光影，9:16竖屏',
    videoStyleTagEn:
      'Dark folklore 2.5D donghua, weathered wood/stone/coarse cloth textures, desaturated eerie palette, dramatic lantern and moonlight, 9:16 vertical',
    characterPromptPrefixZh:
      '暗调民俗国漫角色设定图，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实粗布衣物质感，柔和均匀的影棚光，中性浅灰纯色背景',
    characterPromptPrefixEn:
      'Dark folklore 2.5D character sheet, traditional coarse cloth attire, soft studio light, neutral light-grey background',
    propPromptPrefixZh:
      '暗调民俗国漫道具设定图，电影级2.5D渲染质感，单主体居中，真实陈旧的使用痕迹，45度俯视，柔和影棚光，中性深灰纯色背景',
    propPromptPrefixEn:
      'Dark folklore 2.5D ritual/antique prop sheet, single centered object, aged patina, 45-degree top-down view, neutral dark-grey background',
    scenePromptPrefixZh:
      '暗调民俗国漫场景概念图，电影级2.5D环境绘制，真实空间透视与纵深，阴郁天色，无人物，9:16竖构图',
    scenePromptPrefixEn:
      'Dark folklore 2.5D environment concept art, ancient mountain village and ancestral hall, overcast sky, empty of people, 9:16 vertical',
    characterNegativePromptZh:
      '多余手指，五官扭曲，比例失调，Q版，卡通，真人实拍，塑料皮肤，磨皮滤镜，网红脸，锥子脸，欧式大双眼皮，美瞳，鬼脸，遗体，血腥，文字，水印，复杂背景',
    characterNegativePromptEn:
      'extra fingers, distorted face, chibi, cartoon, plastic skin, influencer face, literal ghost face, corpse, gore, text, watermark, complex background',
    bibleSection3TitleZh:
      '怪谈体系（虚构村落设定、民间传说与禁忌表、每个怪谈背后的人为机关真相表、主角的调查方式）',
    bibleSection10TitleZh:
      '真相进度（逐集真相表：本集怪事、大家以为是什么、实际是什么人为机关；人物秘密表；线索表）',
    bibleSection11TitleZh: '村落地图（村庄、祠堂与古宅的方位暗道布局表，主要场景尺寸表）',
    episodeProgressTemplateZh: '本集怪事｜大家以为是什么｜实际是什么人为的',
    pitfallRulesZh: [
      '民俗氛围感与科学/人为真相闭环：前期营造民俗禁忌压迫感，底层逻辑必须有人为动机与物理机关解释，符合合规要求',
      '严禁直接画恐怖鬼脸、尸体或血腥场面，用红灯笼摇晃、纸人影子、敲门声与人物惊惧眼神营造悬疑感',
      '全片对白精炼（200–350字），留足环境音效（风声、木门吱呀、更梆声）的呼吸空间'
    ],
    forbidModernItems: false,
    keywords: [
      '民俗',
      '怪谈',
      '纸人',
      '祠堂',
      '古宅',
      '村落',
      '禁忌',
      '冥婚',
      '走阴',
      '守村人',
      '红灯笼',
      '绣花鞋',
      '风水',
      '机关'
    ]
  }
]

const GENRE_BY_ID = new Map<string, ManjuGenreSpec>(
  MANJU_GENRE_SPECS.map((spec) => [spec.id, spec])
)

const GENRE_ALIAS_MAP: Record<string, ManjuGenreId> = {
  xianxia: 'xuanhuan-manju',
  xiuzhen: 'xuanhuan-manju',
  修真: 'xuanhuan-manju',
  修仙: 'xuanhuan-manju',
  玄幻: 'xuanhuan-manju',
  gongting: 'gongdou-manju',
  宫廷: 'gongdou-manju',
  zhanshen: 'dushi-manju',
  longwang: 'dushi-manju',
  mori: 'moshi-manju',
  末日: 'moshi-manju',
  apocalypse: 'moshi-manju',
  badao: 'tianchong-manju',
  ceo: 'tianchong-manju',
  suspense: 'xuanyi-manju',
  folklore: 'minsu-manju',
  guaitan: 'minsu-manju'
}

/**
 * 按题材 ID 获取漫剧题材配置（支持简写如 `xuanhuan` / `xianxia` → `xuanhuan-manju`）
 */
export function getManjuGenreSpec(genreId?: string | null): ManjuGenreSpec | null {
  const raw = (genreId ?? '').trim().toLowerCase()
  if (!raw || raw === 'auto') return null
  const direct = GENRE_BY_ID.get(raw)
  if (direct) return direct
  const withSuffix = GENRE_BY_ID.get(`${raw}-manju`)
  if (withSuffix) return withSuffix
  const aliased = GENRE_ALIAS_MAP[raw]
  if (aliased) return GENRE_BY_ID.get(aliased) ?? null
  for (const spec of MANJU_GENRE_SPECS) {
    if (
      spec.nameZh === raw ||
      spec.nameEn.toLowerCase() === raw ||
      raw.includes(spec.id.replace('-manju', '')) ||
      spec.keywords.some((kw) => kw.toLowerCase() === raw)
    ) {
      return spec
    }
  }
  return null
}

/**
 * 从一句话创意、剧本或分镜文本自动识别最匹配的 21 漫剧题材
 */
export function detectManjuGenre(text: string): ManjuGenreSpec {
  const sample = (text ?? '').trim()
  if (!sample) return GENRE_BY_ID.get('dushi-manju')!

  // 1. 优先匹配剧本【项目圣经 · 阶段1】或指令中显式标注的 `xxx-manju` 题材 ID
  const explicitIdMatch = sample.match(/\b([a-z]{3,16}-manju)\b/i)
  if (explicitIdMatch?.[1]) {
    const matched = GENRE_BY_ID.get(explicitIdMatch[1].toLowerCase())
    if (matched) return matched
  }

  let bestSpec = GENRE_BY_ID.get('dushi-manju')!
  let bestScore = 0

  for (const spec of MANJU_GENRE_SPECS) {
    let score = 0
    if (sample.includes(spec.nameZh) || sample.toLowerCase().includes(spec.id)) {
      score += 10
    }
    for (const kw of spec.keywords) {
      if (sample.includes(kw)) {
        score += kw.length >= 3 ? 3 : 2
      }
    }
    if (score > bestScore) {
      bestScore = score
      bestSpec = spec
    }
  }

  if (bestScore === 0) {
    // 启发式古今分流兜底
    if (/[宗门剑仙灵丹朝廷皇宫王爷世子少侠江湖古]/.test(sample)) {
      return GENRE_BY_ID.get('xuanhuan-manju')!
    }
    return GENRE_BY_ID.get('dushi-manju')!
  }
  return bestSpec
}

/**
 * 综合用户显式选择的 `filmGenre` 与上下文文本，解析最终生效的漫剧题材配置
 */
export function resolveManjuGenre(
  explicitGenreId?: string | null,
  contextText?: string
): ManjuGenreSpec {
  const explicit = getManjuGenreSpec(explicitGenreId)
  if (explicit) return explicit
  return detectManjuGenre(contextText ?? '')
}

/**
 * 生成阶段 1~3 剧本创作专属指令（供 `asset.screenplay` 剧本生成节点与 AI 编剧助手注入）
 * 确保产出的剧本天然携带【项目圣经 · 阶段1】、【人物小传（含身高cm与固定外观锚点）】、【场景与主光设定】及【本集卡点与进度 · 阶段3】，
 * 与下游 `film.workbench`（阶段 4 分镜拆解 + 11 项连戏审计 + 阶段 5 运营发布包）形成 100% 工业闭环。
 */
export function buildManjuScreenplayDirective(genre: ManjuGenreSpec, locale = 'zh-CN'): string {
  const isEn = locale.toLowerCase().startsWith('en')
  const midDur = Math.round((genre.shotDurationRangeSec[0] + genre.shotDurationRangeSec[1]) / 2)
  if (isEn) {
    return [
      `## [ai-manju-skills · Stage 1-3 Industrial Screenplay Specification (${genre.nameEn} / ${genre.id})]`,
      `- Active Genre Skill: ${genre.nameEn} (${genre.id}) | Category: ${genre.category}`,
      `- Visual Style Anchor (STYLE01): ${genre.visualStyleEn}`,
      `- Recommended Pacing per Episode: ${genre.shotCountRange[0]}-${genre.shotCountRange[1]} shots, ~${midDur}s/shot, ${genre.dialogueCharsRange[0]}-${genre.dialogueCharsRange[1]} total dialogue characters.`,
      `- Stage 1 Project Bible Header (MUST output right after Title):`,
      `  Include a [Project Bible · Stage 1] block specifying Genre Skill (${genre.id}), Visual Style (STYLE01), Core Satisfaction Loop, and World Key Light Law.`,
      `- Stage 1 Character Bios with Height (cm) & Consistency Anchors (MUST output in [Character Bios]):`,
      `  Every character line MUST include explicit height in cm (e.g. 182cm / 166cm) and 3-4 immutable visual consistency anchors (hairstyle/color, signature outfit/material, distinct accessory/mark) so downstream storyboard breakdown locks multi-character height differentials.`,
      `- Stage 1 Scene & World Key-Light Block (MUST output in [Scene & Lighting Bible]):`,
      `  List each main location with spatial dimensions (e.g. 15m x 20m x 6m) and a single constant World Key-Light Direction (e.g. cold moonlight from upper-left tall window).`,
      `- Stage 3 Episode Script Hard Rules:`,
      `  1) 3-Second Cold Open: Scene 1 MUST open with an immediate visual/conflict hook within the first 3 seconds.`,
      `  2) Spoken Dialogue Quota >= 2/3 (67%): At least 2/3 of all lines MUST be spoken on-screen dialogue; inner monologue (OS) + voiceover (VO) MUST NOT exceed 1/3.`,
      `  3) Lip-Sync Pacing <= 4 chars/sec: Keep each dialogue line crisp and punchy; never cram long paragraphs into a single breath.`,
      `  4) Stage 3 Episode Footer: At the end of each episode, output an [Episode Hook & Progress · Stage 3] block following the genre progress formula: ${genre.episodeProgressTemplateZh}.`,
      `- Genre Pitfall Redlines: ${genre.pitfallRulesZh.join('; ')}`
    ].join('\n')
  }
  return [
    `## 【ai-manju-skills · 阶段1~3 漫剧工业剧本规范（${genre.nameZh} / ${genre.id}）】`,
    `- 当前绑定题材 Skill：${genre.nameZh}（${genre.id}）｜ 题材分类：${genre.category === 'ancient' ? '古代历史/宫斗/武侠' : genre.category === 'fantasy' ? '玄幻/科幻/末世/系统' : genre.category === 'modern' ? '现代都市/甜宠/商战' : '悬疑刑侦/民俗怪谈'}`,
    `- 视觉定调锚点（STYLE01）：${genre.visualStyleZh}`,
    `- 单集推荐规格：每集建议拆解 ${genre.shotCountRange[0]}~${genre.shotCountRange[1]} 镜（约 ${midDur} 秒/镜），单集总台词字数严格控制在 ${genre.dialogueCharsRange[0]}~${genre.dialogueCharsRange[1]} 字。`,
    `- 【阶段1 · 项目圣经立项卡】（必须在「剧本名：…」下方输出）：`,
    `  输出【项目圣经 · 阶段1】区块，写明题材流派（${genre.nameZh}（${genre.id}））、视觉定调（STYLE01）、核心爽点闭环与全局主光定律。`,
    `- 【阶段1 · 人物小传（含身高cm与固定外观锚点）】（必须在【人物小传】区块严格执行）：`,
    `  每位角色必须显式标注精确身高（如 185cm / 165cm）及 3~4 项不可变外观一致性锚点（发色发型、标志性服装材质、专属配饰/面部特征），供下游影视工作台自动锁死双人同框身高差与 P01/P02 角色定妆图。`,
    `- 【阶段1 · 场景与主光设定】（在【人物小传】下方输出【场景设定】区块）：`,
    `  列出本集核心场景的空间尺寸（长×宽×高，如 20m×15m×6m）与恒定「世界主光方向」（如：左上方高窗冷月光斜射），供下游分镜拆解锁定同场戏光影一致性。`,
    `- 【阶段3 · 分集剧本四大硬红线】：`,
    `  1) 黄金前3秒冷开场：每集第1场戏前3秒必须直接切入强冲突、强反差或生死危机画面（用 △ 动作行具象呈现）。`,
    `  2) 出声对白占比 ≥ 2/3（67%）：出声台词必须占总台词量的 2/3 以上，内心独白（OS）与旁白（VO）合计严禁超过 1/3，拒绝大段心理独白水时长。`,
    `  3) 口型镜语速 ≤ 4字/秒：单句台词短促有力，禁止长句堆砌导致下游视频配音倍速吞字。`,
    `  4) 阶段3卡点尾栏：每集末尾必须输出【本集卡点与进度 · 阶段3】区块，严格套用本题材进度公式：「${genre.episodeProgressTemplateZh}」，并写明黄金前3秒抓手与结尾断章钩子。`,
    `- 【本题材避坑红线】：${genre.pitfallRulesZh.join('；')}`
  ].join('\n')
}

/**
 * 生成阶段2 `STYLE01` 风格定调图提示词（先出 1 张定调全剧色彩与光影基调）
 */
export function buildManjuStyleAnchorPrompt(
  genre: ManjuGenreSpec,
  customStyle?: string,
  locale = 'zh-CN'
): string {
  const styleText =
    customStyle?.trim() || (locale.startsWith('en') ? genre.visualStyleEn : genre.visualStyleZh)
  if (locale.toLowerCase().startsWith('en')) {
    return [
      `Style Anchor Sheet (STYLE01): ${styleText}.`,
      `Master key visual establishing the series color palette, lighting contrast, surface material rendering, and atmospheric tone.`,
      `Cinematic composition, empty establishing mood or silhouette focal point, 9:16 vertical aspect ratio, 1080x1920, no text, no watermark, no UI.`
    ].join(' ')
  }
  return [
    `风格定调图（STYLE01）：${styleText}。`,
    `作为全季视觉母版，锁死全剧主色调、冷暖光影反差、材质渲染精度与空气氛围感。`,
    `${genre.videoStyleTagZh}，9:16竖构图，无文字，无水印，无字幕，无UI边框。`
  ].join('')
}
