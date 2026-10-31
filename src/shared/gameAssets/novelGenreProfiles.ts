/**
 * 小说流派引擎（Novel Genre Profile）：
 * 为 `asset.novel` 逐章连载与 `game.economy` 数值切片提供「题材语义层」——
 * 分卷主题、境界/阶段命名、主角成长轴 vs 阻力轴、阶段解锁物名称、单章四拍节拍模板、
 * 默认人物名录、默认长线伏笔、局部精修按钮与写作风格指令。
 *
 * 数值曲线（战力包络、反派膨胀、突破阶梯）仍由经济系统工作台提供，
 * 本模块只负责把同一条曲线「翻译」成不同流派的叙事语言，从而支持任意类型小说。
 *
 * 纯数据 + 纯函数，无 DOM / 无 gameNumericalWorkbench 依赖（避免循环引用）。
 * 本文件为 AI 提示词域数据（双语），已登记在 scripts/check-hardcoded-cjk.mjs 豁免清单。
 */

export type NovelGenreId =
  | 'urban_reversal'
  | 'xianxia_cultivation'
  | 'mystery_detective'
  | 'romance_palace'
  | 'scifi_apocalypse'
  | 'lovecraft_rules'
  | 'historical_intrigue'
  | 'custom_literary'

export type NovelGenreBeatType =
  'setup_endure' | 'encounter_growth' | 'villain_suppression_cliffhanger' | 'climax_reversal_slap'

export interface NovelGenreBeatSpec {
  badgeZh: string
  badgeEn: string
  /** 写入单章数值围栏的节拍指令 */
  labelZh: string
  /** 细纲标题模板（不含「第N章：」前缀） */
  titleZh: string
  titleEn: string
  coreConflictZh: string
  cliffhangerZh: string
}

export interface NovelGenreRosterSeed {
  name: string
  faction: 'protagonist' | 'ally' | 'villain' | 'neutral'
  role: string
  note: string
}

export interface NovelGenreForeshadowSeed {
  title: string
  /** 可用占位符：{start} {end} */
  payoffHint: string
}

export interface NovelGenrePolishSpec {
  slapZh: string
  slapEn: string
  expandZh: string
  expandEn: string
  fixZh: string
  fixEn: string
  hookZh: string
  hookEn: string
  /** 选区精修追加文本模板（占位符同节拍模板） */
  slapAddonZh: string
  expandAddonZh: string
  hookAddonZh: string
}

export interface NovelGenreProfile {
  id: NovelGenreId
  labelZh: string
  labelEn: string
  icon: string
  volumeThemesZh: string[]
  stageNamesZh: string[]
  stageTermZh: string
  stageTermEn: string
  protagonistAxisZh: string
  protagonistAxisEn: string
  antagonistAxisZh: string
  antagonistAxisEn: string
  unlockTermZh: string
  unlockTermEn: string
  encounterTermZh: string
  /** 阶段解锁物（从低阶到终局排序；仅在经济系统为未修改的内置预设时替代实体配表） */
  unlockItemsZh: string[]
  /** 奇遇/线索/机缘池 */
  encounterItemsZh: string[]
  beats: Record<NovelGenreBeatType, NovelGenreBeatSpec>
  roster: NovelGenreRosterSeed[]
  /** 依次对应 前期 / 中期 / 后期 三条长线伏笔 */
  foreshadowings: [NovelGenreForeshadowSeed, NovelGenreForeshadowSeed, NovelGenreForeshadowSeed]
  polish: NovelGenrePolishSpec
  styleDirectiveZh: string
  styleDirectiveEn: string
  worldBibleSeedZh: string[]
  /** 章末钩子检测关键词（正则源） */
  hookKeywordsRe: string
}

export interface NovelGenreCustomOverrides {
  stagesText?: string
  axisProtagonist?: string
  axisAntagonist?: string
  unlockTerm?: string
}

export function fillNovelGenreTemplate(
  tpl: string,
  vars: Record<string, string | number | undefined>
): string {
  return tpl.replace(/\{(\w+)\}/g, (m, key: string) => {
    const v = vars[key]
    return v === undefined || v === null || v === '' ? m : String(v)
  })
}

const URBAN: NovelGenreProfile = {
  id: 'urban_reversal',
  labelZh: '都市逆袭 / 战神爽文',
  labelEn: 'Urban Reversal',
  icon: '🏙️',
  volumeThemesZh: [
    '潜龙在渊 · 基层受辱与微末觉醒',
    '锋芒初露 · 本土豪门洗牌与立威',
    '省域争锋 · 权贵围剿与底蕴扩张',
    '名震一方 · 跨界巨擘博弈与破壁',
    '巅峰暗涌 · 隐世财阀与禁区交锋',
    '只手遮天 · 顶级秩序重构与清算',
    '举世皆惊 · 终极宿敌总决战前夜',
    '万流归宗 · 登顶至尊与终局大审判'
  ],
  stageNamesZh: [
    '第 0 阶·微末蛰伏期',
    '第 1 阶·初醒立威期',
    '第 2 阶·堂口掌权期',
    '第 3 阶·豪门座上宾',
    '第 4 阶·商界操盘手',
    '第 5 阶·省域巨头期',
    '第 6 阶·隐世掌舵人',
    '第 7 阶·执棋造浪者',
    '第 8 阶·当世无冕王'
  ],
  stageTermZh: '境界/身份阶位',
  stageTermEn: 'Status Tier',
  protagonistAxisZh: '权势战力',
  protagonistAxisEn: 'Power',
  antagonistAxisZh: '反派施压',
  antagonistAxisEn: 'Villain Pressure',
  unlockTermZh: '底牌',
  unlockTermEn: 'Trump Cards',
  encounterTermZh: '奇遇信物',
  unlockItemsZh: [
    '隐忍蛰伏·暗中布局',
    '甩出铁证·舆论崩塌',
    '首富到场·下跪接驾',
    '系统百倍觉醒',
    '真身揭晓·全员震怖'
  ],
  encounterItemsZh: [
    '拍卖会古玩捡漏第一桶金',
    '黑料铁证U盘',
    '隐世古武宗师护道人',
    '三年隐忍修为解封',
    '海外万亿主权基金掌控权'
  ],
  beats: {
    setup_endure: {
      badgeZh: '起势铺垫',
      badgeEn: 'Setup & Endure',
      labelZh: '起势铺垫与隐忍蓄势期（铺垫冲突导火索、主角隐忍布局、严禁提前亮底牌秒杀）',
      titleZh: '风暴将起·隐忍蓄势（{stage}）',
      titleEn: 'Storm Brewing & Hidden Edge',
      coreConflictZh: '反派借势挑衅施压，主角在【{stage}】表面隐忍周旋，暗中锁定机缘【{item}】。',
      cliffhangerZh: '章末反派设下公开赌局/鸿门宴，试图在下一章彻底将主角踩入泥潭。'
    },
    encounter_growth: {
      badgeZh: '奇遇立威',
      badgeEn: 'Encounter & Growth',
      labelZh: '机缘获取与小试牛刀期（触发奇遇/人脉信物、局部小反击立威，引出幕后真正主使）',
      titleZh: '机缘入袋·初露锋芒（{item}）',
      titleEn: 'Relic Acquired & First Strike',
      coreConflictZh: '主角成功获取/激活【{item}】，战力逼近上限 {ceiling}，随手惩戒反派爪牙立威。',
      cliffhangerZh: '爪牙溃败引出幕后真正主使，对方动用威胁值 {pressure} 的杀招封锁全场。'
    },
    villain_suppression_cliffhanger: {
      badgeZh: '绝境卡点',
      badgeEn: 'Villain Pressure Wall',
      labelZh: '反派极限施压与绝境卡点期（反派动用底牌将主角逼入绝境，章末必须留高能反转悬念钩子）',
      titleZh: '绝境围剿·底牌将出（反派威胁 {pressure}）',
      titleEn: 'Cornered at the Pressure Wall',
      coreConflictZh:
        '本幕反派倾巢而出（压迫强度 {pressure}），众目睽睽下逼主角低头认罪，全场冷嘲热讽达到顶点。',
      cliffhangerZh:
        '千钧一发之际，主角冷笑抬眸，手按核心底牌【{unlock}】，大人物车队/异象已至门外！'
    },
    climax_reversal_slap: {
      badgeZh: '高潮打脸',
      badgeEn: 'Climax Reversal Slap',
      labelZh: '本幕高潮亮底牌与身份审判打脸期（按最优连招亮出本阶段准入底牌，彻底碾压本幕反派）',
      titleZh: '底牌全开·雷霆清算（执掌{unlock}）',
      titleEn: 'Trump Card Unfolded & Total Reversal',
      coreConflictZh:
        '主角按最优乘区顺序连环亮出【{unlockTop}】，战力爆发至 {ceiling} 彻底粉碎反派依仗，全场权贵骇然跪拜！',
      cliffhangerZh: '本幕宿敌伏诛清算，但战利品中浮现指向更高阶势力（下一幕）的惊天秘辛钩子。'
    }
  },
  roster: [
    {
      name: '林玄',
      faction: 'protagonist',
      role: '隐忍赘婿',
      note: '男主，表面隐忍赘婿，实则执掌黑金龙卡与百倍觉醒系统'
    },
    {
      name: '赵天豪',
      faction: 'ally',
      role: '百亿商界巨擘 · 核心人脉',
      note: '受男主救命大恩，唯男主马首是瞻，负责前中期商战护航'
    },
    {
      name: '苏清雪',
      faction: 'villain',
      role: '初级反派',
      note: '嫌贫爱富当众退婚，第 1 幕高潮被男主亮底牌打脸清算'
    },
    {
      name: '省城豪门大少',
      faction: 'villain',
      role: '省域豪门爪牙 · 幕后黑手前哨',
      note: '觊觎苏家产业与男主奇遇信物，引出第 2 卷省域冲突'
    }
  ],
  foreshadowings: [
    {
      title: '退婚宴三日之约与信物真伪验证',
      payoffHint: '反派嘲笑信物为地摊假货，需在第 {start}~{end} 章首富到场时当众验证打脸'
    },
    {
      title: '省域隐世豪门封锁令与父母失踪旧案线索',
      payoffHint: '第 {start}~{end} 章进入省域大地图时，揭晓当年设局害林家的幕后推手'
    },
    {
      title: '终局禁区血脉玉佩与最高权限解封',
      payoffHint: '全书后期（第 {start}~{end} 章）突破最高阶位时解封终极底牌完成清算'
    }
  ],
  polish: {
    slapZh: '强化打脸爽感与全场震惊',
    slapEn: 'Boost Reversal & Crowd Shock',
    expandZh: '扩写五感与动作细节 (+300字)',
    expandEn: 'Expand Atmosphere (+300 chars)',
    fixZh: '修正战力与替换违规底牌',
    fixEn: 'Calibrate Power & Trumps',
    hookZh: '改写为高能断章悬念钩子',
    hookEn: 'Rewrite as Cliffhanger Hook',
    slapAddonZh:
      '全场死一般的寂静！当那枚象征着绝对权柄的【{unlock}】亮出的刹那，原本满堂的讥讽哄笑戛然而止，前排权贵瞳孔剧烈收缩，冷汗瞬间浸透后背！',
    expandAddonZh:
      '森冷的水晶灯光在大理石地面上折射出刺骨寒意，空气仿佛在这一刻彻底凝固。【{stage}】的无形威压与高达 {pressure} 的反派杀机在半空中轰然对撞！',
    hookAddonZh:
      '然而就在全场以为尘埃落定的刹那，厚重的雕花大门轰然洞开——一道镌刻着【{item}】印记的血色急电骤然亮起，真正的幕后大人物已在门外三步之遥！'
  },
  styleDirectiveZh:
    '都市逆袭爽文：节奏明快、冲突密集，压抑—蓄势—亮底牌—打脸四拍递进，章末必留强钩子；主角不圣母、不降智。',
  styleDirectiveEn:
    'Urban reversal web-novel: fast pacing, dense conflict, endure→build→reveal→payoff, strong cliffhanger every chapter.',
  worldBibleSeedZh: [
    '- 力量与财富铁律：严格遵循数值工作台乘区公式与阶位阶梯，跨阶对敌需借势或触发准入底牌，严禁无代价越级秒杀。',
    '- 主角核心底色：隐忍果决、谋定后动，不圣母、不降智，底牌按最优交锋序列层层递进揭晓。'
  ],
  hookKeywordsRe: '忽然|骤然|轰然|震动|瞳孔|冷笑|踏入|亮出|电话|警报|跪|死寂|惊呼|究竟|倒计时|门外'
}

const XIANXIA: NovelGenreProfile = {
  id: 'xianxia_cultivation',
  labelZh: '东方玄幻 / 修仙长生',
  labelEn: 'Xianxia Cultivation',
  icon: '⚔️',
  volumeThemesZh: [
    '凡尘问道 · 宗门杂役与灵根觉醒',
    '外门争锋 · 秘境试炼与筑基',
    '内门风云 · 宗门大比与结丹',
    '游历四域 · 古战场机缘与元婴',
    '正魔大劫 · 宗门覆灭与化神',
    '飞升前夜 · 上古禁地与渡劫',
    '灵界争霸 · 仙门博弈与大乘',
    '万古长青 · 天道清算与证道'
  ],
  stageNamesZh: [
    '凡人',
    '炼气期',
    '筑基期',
    '金丹期',
    '元婴期',
    '化神期',
    '炼虚期',
    '合体期',
    '大乘期',
    '渡劫期',
    '真仙境'
  ],
  stageTermZh: '修为境界',
  stageTermEn: 'Cultivation Realm',
  protagonistAxisZh: '修为战力',
  protagonistAxisEn: 'Cultivation Power',
  antagonistAxisZh: '强敌/天劫威压',
  antagonistAxisEn: 'Foe & Tribulation',
  unlockTermZh: '法宝神通',
  unlockTermEn: 'Artifacts & Arts',
  encounterTermZh: '天材地宝/机缘',
  unlockItemsZh: [
    '基础剑诀·御风术',
    '残缺古经·太虚引气篇',
    '本命飞剑·青冥',
    '上古阵图·周天星斗阵',
    '混沌青莲·本源神通'
  ],
  encounterItemsZh: [
    '千年灵芝',
    '上古修士洞府玉简',
    '雷劫淬体残液',
    '龙血菩提果',
    '时空裂缝中的半截仙剑'
  ],
  beats: {
    setup_endure: {
      badgeZh: '潜修蓄势',
      badgeEn: 'Secluded Cultivation',
      labelZh: '潜修蓄势期（宗门排挤或资源匮乏，主角苦修打磨根基，严禁越阶无代价斩敌）',
      titleZh: '山门风雪·潜修问心（{stage}）',
      titleEn: 'Snow at the Sect Gate',
      coreConflictZh:
        '主角处于【{stage}】，遭同门排挤克扣资源，借{item}的线索暗中苦修，打磨道心与根基。',
      cliffhangerZh: '深夜闭关时，丹田中沉寂的古经残页突然自行运转，指向一处被宗门封禁的禁地。'
    },
    encounter_growth: {
      badgeZh: '秘境机缘',
      badgeEn: 'Secret Realm',
      labelZh: '秘境机缘期（探索秘境/洞府获得天材地宝，小试新神通，引出更强敌对势力）',
      titleZh: '秘境开启·{item}出世',
      titleEn: 'Secret Realm Opens',
      coreConflictZh:
        '秘境开启，主角夺得【{item}】，修为逼近上限 {ceiling}，以新悟神通斩落觊觎者。',
      cliffhangerZh: '秘境深处传来一声苍老叹息，一位被封印万年的老怪睁开了眼睛。'
    },
    villain_suppression_cliffhanger: {
      badgeZh: '劫难压境',
      badgeEn: 'Tribulation Looms',
      labelZh: '劫难压境期（强敌或天劫以压倒性威压逼近，主角陷入生死绝境，章末留破局悬念）',
      titleZh: '杀劫临身·{stage}之危（威压 {pressure}）',
      titleEn: 'Killing Tribulation',
      coreConflictZh:
        '敌宗长老携 {pressure} 威压降临，同门噤若寒蝉，主角被逼至悬崖绝地，经脉寸断。',
      cliffhangerZh: '濒死之际，主角识海中【{unlock}】轰然震鸣，九天之上劫云开始倒卷。'
    },
    climax_reversal_slap: {
      badgeZh: '破境斩敌',
      badgeEn: 'Breakthrough Strike',
      labelZh: '破境斩敌期（于生死间突破境界，祭出本阶段法宝神通，逆斩强敌，震慑四方）',
      titleZh: '一剑破境·{unlock}现世',
      titleEn: 'Breakthrough with One Sword',
      coreConflictZh:
        '主角于雷劫中破境，接连祭出【{unlockTop}】，修为暴涨至 {ceiling}，一剑斩落强敌，全宗震动。',
      cliffhangerZh: '强敌陨落时神魂中飞出一枚血色令牌，上面刻着一个早已消失的上古宗门之名。'
    }
  },
  roster: [
    {
      name: '陆尘',
      faction: 'protagonist',
      role: '杂役弟子',
      note: '男主，伪灵根被视为废材，实则体内封印上古传承'
    },
    {
      name: '苏若雪',
      faction: 'ally',
      role: '内门天骄',
      note: '冷面师姐，暗中照拂主角，身负冰魄道体'
    },
    {
      name: '赵元霸',
      faction: 'villain',
      role: '外门执事之子',
      note: '仗势欺人，屡次克扣主角资源，前期宿敌'
    },
    {
      name: '血煞老祖',
      faction: 'villain',
      role: '魔道巨擘',
      note: '觊觎主角体内传承，中期最大威胁'
    }
  ],
  foreshadowings: [
    {
      title: '伪灵根之谜与体内封印',
      payoffHint: '第 {start}~{end} 章揭示伪灵根实为上古封印，主角首次触动传承'
    },
    {
      title: '宗门禁地与师尊陨落旧案',
      payoffHint: '第 {start}~{end} 章查明当年师尊陨落真相，牵出魔道内应'
    },
    {
      title: '上古仙门覆灭与天道残缺之秘',
      payoffHint: '全书后期（第 {start}~{end} 章）揭晓天道残缺真相并完成证道'
    }
  ],
  polish: {
    slapZh: '强化斗法场面与众修震撼',
    slapEn: 'Boost Duel Spectacle',
    expandZh: '扩写灵气/法术意象 (+300字)',
    expandEn: 'Expand Qi & Spell Imagery',
    fixZh: '修正修为越阶与违规神通',
    fixEn: 'Calibrate Realm & Arts',
    hookZh: '改写为天地异象悬念钩子',
    hookEn: 'Rewrite as Omen Hook',
    slapAddonZh:
      '剑光过处，天地失色！【{unlock}】绽放出的威能令观战修士齐齐倒吸冷气，几位长老更是霍然起身，满脸不可置信。',
    expandAddonZh:
      '灵气如潮汐般在四周翻涌，青色剑气在虚空中拉出道道裂痕，【{stage}】的灵压与对方 {pressure} 的威势碰撞出漫天星火。',
    hookAddonZh:
      '就在此时，天穹骤暗，一道刻满上古符文的青铜巨门在云海中缓缓浮现，门后传来一声低沉的呼唤——与【{item}】隐隐共鸣。'
  },
  styleDirectiveZh:
    '东方玄幻修仙：境界体系严谨、斗法有逻辑与代价，重意境与道心描写；越阶战斗必须依赖法宝/神通/阵法或付出代价。',
  styleDirectiveEn:
    'Xianxia: strict realm hierarchy, logical duels with costs, rich imagery of qi and dao-heart.',
  worldBibleSeedZh: [
    '- 修炼体系铁律：境界依次为 炼气→筑基→金丹→元婴→化神→炼虚→合体→大乘→渡劫，每一大境界存在天堑，越阶对敌必须借助法宝、阵法或付出寿元/根基代价。',
    '- 主角核心底色：坚韧隐忍、恩怨分明，求道之心不改，不无脑嗜杀。'
  ],
  hookKeywordsRe: '忽然|骤然|轰然|异象|劫云|雷光|睁开|血色|裂缝|呼唤|封印|究竟|陨落'
}

const MYSTERY: NovelGenreProfile = {
  id: 'mystery_detective',
  labelZh: '悬疑刑侦 / 本格推理',
  labelEn: 'Mystery & Detective',
  icon: '🔍',
  volumeThemesZh: [
    '雨夜第一案 · 密室与不在场证明',
    '连环迷雾 · 模仿犯与旧档案',
    '暗流涌动 · 警队内鬼与证据链断裂',
    '十年悬案 · 消失的证人',
    '镜像凶手 · 心理侧写对决',
    '真相边缘 · 幕后操盘者现身',
    '终局审判 · 所有线索的交汇',
    '尘埃落定 · 正义的代价'
  ],
  stageNamesZh: [
    '案发迷雾期',
    '外围排查期',
    '线索拼接期',
    '红鲱鱼误导期',
    '核心诡计破解期',
    '真凶锁定期',
    '对质审判期'
  ],
  stageTermZh: '侦破阶段',
  stageTermEn: 'Investigation Stage',
  protagonistAxisZh: '真相还原度',
  protagonistAxisEn: 'Truth Recovery',
  antagonistAxisZh: '诡计迷雾度',
  antagonistAxisEn: 'Deception Fog',
  unlockTermZh: '关键证据',
  unlockTermEn: 'Key Evidence',
  encounterTermZh: '线索',
  unlockItemsZh: [
    '现场遗留的半枚鞋印',
    '监控时间轴的 7 分钟空白',
    '法医报告中的二次创伤',
    '证人口供里的季节错误',
    '凶手无法伪造的生物证据'
  ],
  encounterItemsZh: [
    '被撕掉一角的旧照片',
    '一张反常的超市小票',
    '死者手机里的定时短信',
    '十年前的卷宗编号',
    '一枚不属于任何人的钥匙'
  ],
  beats: {
    setup_endure: {
      badgeZh: '案发迷雾',
      badgeEn: 'Crime & Fog',
      labelZh: '案发与迷雾期（呈现异常现场与疑点，公平地向读者埋下线索，严禁提前揭示凶手）',
      titleZh: '异常现场·{item}',
      titleEn: 'The Abnormal Scene',
      coreConflictZh: '主角处于【{stage}】，面对看似完美的现场，注意到一处违和细节——{item}。',
      cliffhangerZh: '复勘现场时，主角发现死者在临死前留下了一个指向在场某人的符号。'
    },
    encounter_growth: {
      badgeZh: '取证推进',
      badgeEn: 'Evidence Gathering',
      labelZh: '取证与推进期（走访、勘查、交叉比对，获得新证据，排除部分嫌疑人）',
      titleZh: '交叉比对·{unlock}浮出水面',
      titleEn: 'Cross-Examination',
      coreConflictZh:
        '通过走访与比对，主角获得【{unlock}】，真相还原度升至 {ceiling}，一名嫌疑人的不在场证明出现裂缝。',
      cliffhangerZh: '就在锁定嫌疑人的当晚，该嫌疑人被发现死在自家浴室，现场同样是密室。'
    },
    villain_suppression_cliffhanger: {
      badgeZh: '误导反转',
      badgeEn: 'Red Herring Twist',
      labelZh: '误导与反转期（伪解答被推翻、证据链断裂、主角遭质疑，章末留新的决定性疑点）',
      titleZh: '伪解答崩塌·迷雾加深（迷雾度 {pressure}）',
      titleEn: 'The False Solution Collapses',
      coreConflictZh:
        '主角给出的推理被新证据推翻，诡计迷雾度升至 {pressure}，上级勒令停职，舆论将矛头指向主角。',
      cliffhangerZh: '停职当夜，主角重看监控时意识到：所有人都看错了时间——凶手利用了【{unlock}】。'
    },
    climax_reversal_slap: {
      badgeZh: '真相揭晓',
      badgeEn: 'The Reveal',
      labelZh: '真相揭晓期（以本阶段关键证据完成逻辑闭环，当众拆解诡计，指认真凶）',
      titleZh: '诡计拆解·凶手就是你',
      titleEn: 'The Trick Unravelled',
      coreConflictZh:
        '主角召集所有相关人，依次摆出【{unlockTop}】，严密推演拆解诡计，真相还原度达到 {ceiling}，真凶无可辩驳。',
      cliffhangerZh: '真凶被带走前低声说了一句：“你以为我是最后一个吗？”——指向更大的幕后。'
    }
  },
  roster: [
    {
      name: '沈默',
      faction: 'protagonist',
      role: '刑侦支队顾问',
      note: '主角，前犯罪心理学讲师，观察力极强，因旧案心结离开学院'
    },
    {
      name: '林晚',
      faction: 'ally',
      role: '法医',
      note: '冷静专业，与主角互相信任，掌握关键尸检证据'
    },
    {
      name: '周副局长',
      faction: 'neutral',
      role: '警队高层',
      note: '态度暧昧，屡次阻挠调查，身份存疑'
    },
    {
      name: '“钟表匠”',
      faction: 'villain',
      role: '连环案幕后者',
      note: '擅长时间诡计，始终比警方快一步'
    }
  ],
  foreshadowings: [
    { title: '死者留下的符号含义', payoffHint: '第 {start}~{end} 章解读符号，锁定第一案真凶' },
    {
      title: '十年前未结卷宗与主角旧案心结',
      payoffHint: '第 {start}~{end} 章揭示旧案与当前连环案的关联'
    },
    {
      title: '“钟表匠”的真实身份',
      payoffHint: '全书后期（第 {start}~{end} 章）揭晓“钟表匠”身份并完成终局对质'
    }
  ],
  polish: {
    slapZh: '强化推理逻辑与众人震惊',
    slapEn: 'Sharpen Deduction Reveal',
    expandZh: '扩写现场勘查与氛围 (+300字)',
    expandEn: 'Expand Scene Investigation',
    fixZh: '修正提前泄底的证据',
    fixEn: 'Fix Premature Evidence',
    hookZh: '改写为悬疑反转钩子',
    hookEn: 'Rewrite as Mystery Hook',
    slapAddonZh:
      '会议室里一片死寂。当【{unlock}】被投影到屏幕上的那一刻，所有人都意识到——之前的一切推论都建立在凶手精心设计的错觉之上。',
    expandAddonZh:
      '雨水顺着窗框缓慢滑落，房间里残留着淡淡的消毒水味。地板上的划痕方向、茶杯的温度、挂钟慢了的四分钟，都在无声地讲述另一个版本的故事。',
    hookAddonZh:
      '就在主角准备离开时，手机屏幕亮起——一条来自死者号码的新短信：“你漏掉了【{item}】。”'
  },
  styleDirectiveZh:
    '悬疑推理：遵循公平性原则，线索须提前向读者呈现；氛围克制冷峻，逻辑严密；每章推进一个疑点并留下新的悬念。',
  styleDirectiveEn:
    'Mystery: fair-play clues, restrained atmosphere, rigorous logic, one question resolved and one raised per chapter.',
  worldBibleSeedZh: [
    '- 推理铁律：所有关键证据必须在揭晓前以可被读者察觉的方式出现；禁止超自然解释与凭空出现的证人。',
    '- 主角核心底色：理性克制、尊重证据，有心结但不滥用直觉。'
  ],
  hookKeywordsRe: '忽然|骤然|短信|尸体|密室|指纹|监控|为什么|究竟|不可能|消失|血迹|门外'
}

const ROMANCE: NovelGenreProfile = {
  id: 'romance_palace',
  labelZh: '古言宫斗 / 现代言情',
  labelEn: 'Romance & Palace Intrigue',
  icon: '🌸',
  volumeThemesZh: [
    '初遇 · 错位的相逢与试探',
    '心动 · 暗生情愫与身份阻隔',
    '风波 · 误会与修罗场',
    '虐心 · 分离与真相掩埋',
    '破局 · 联手对抗阴谋',
    '回首 · 旧誓与成长',
    '并肩 · 携手登顶',
    '圆满 · 双向奔赴与归宿'
  ],
  stageNamesZh: [
    '陌路试探',
    '暗生情愫',
    '心意萌动',
    '误会拉扯',
    '虐心分离',
    '真相大白',
    '并肩相守',
    '执手白头'
  ],
  stageTermZh: '关系阶段',
  stageTermEn: 'Relationship Stage',
  protagonistAxisZh: '情感羁绊/位份威望',
  protagonistAxisEn: 'Bond & Standing',
  antagonistAxisZh: '误会阻力/情敌算计',
  antagonistAxisEn: 'Misunderstanding & Rivalry',
  unlockTermZh: '情感信物/身世底牌',
  unlockTermEn: 'Tokens & Secrets',
  encounterTermZh: '心动事件',
  unlockItemsZh: [
    '一方绣着名字的手帕',
    '雨夜共撑的一把伞',
    '母亲留下的半块玉佩',
    '先帝密诏',
    '被隐瞒的真实身世'
  ],
  encounterItemsZh: [
    '上元灯会的偶遇',
    '一封未寄出的信',
    '宫宴上的一支舞',
    '病榻前的彻夜守候',
    '旧日约定的那棵海棠'
  ],
  beats: {
    setup_endure: {
      badgeZh: '相遇试探',
      badgeEn: 'Meet & Probe',
      labelZh: '相遇与试探期（制造身份/立场错位的互动张力，情绪克制，严禁过早告白）',
      titleZh: '{item}·心湖微澜',
      titleEn: 'Ripples on the Heart Lake',
      coreConflictZh: '二人处于【{stage}】，因{item}再度交集，言语交锋间暗藏试探与在意。',
      cliffhangerZh: '临别时，对方留下一句意味不明的话，让女主整夜辗转难眠。'
    },
    encounter_growth: {
      badgeZh: '心动升温',
      badgeEn: 'Growing Feelings',
      labelZh: '心动升温期（共同经历事件，情感羁绊加深，出现明确的心动瞬间）',
      titleZh: '共历风雨·{unlock}',
      titleEn: 'Weathering Storms Together',
      coreConflictZh:
        '一场意外让二人并肩应对，女主得到【{unlock}】，情感羁绊升至 {ceiling}，心动无可回避。',
      cliffhangerZh: '就在心意将明之时，一道赐婚圣旨/一则婚约消息骤然传来。'
    },
    villain_suppression_cliffhanger: {
      badgeZh: '误会虐心',
      badgeEn: 'Heartbreak',
      labelZh: '误会与虐心期（情敌设局或身份阻隔引发误会，关系降至冰点，章末留真相钩子）',
      titleZh: '一纸误会·咫尺天涯（阻力 {pressure}）',
      titleEn: 'A Misunderstanding Apart',
      coreConflictZh:
        '情敌精心设局，阻力升至 {pressure}，男主亲眼“目睹”背叛，二人决裂，女主独自承受流言。',
      cliffhangerZh: '女主在旧物中发现【{unlock}】的另一半，真相似乎与她想的完全不同。'
    },
    climax_reversal_slap: {
      badgeZh: '真相破局',
      badgeEn: 'Truth Prevails',
      labelZh: '真相与破局期（以信物/身世揭开真相，当众澄清，情感与地位双双逆转）',
      titleZh: '真相大白·{unlock}',
      titleEn: 'The Truth Revealed',
      coreConflictZh:
        '女主当众呈出【{unlockTop}】，揭穿情敌阴谋，情感羁绊回升至 {ceiling}，男主追悔，二人重新靠近。',
      cliffhangerZh: '尘埃落定之际，一封来自远方的密信揭示：女主的身世背后还藏着更大的秘密。'
    }
  },
  roster: [
    {
      name: '沈知意',
      faction: 'protagonist',
      role: '没落侯府嫡女',
      note: '女主，聪慧隐忍，身世成谜'
    },
    {
      name: '萧珩',
      faction: 'ally',
      role: '摄政王',
      note: '男主，冷面深情，表面疏离实则多次暗中相护'
    },
    {
      name: '柳如烟',
      faction: 'villain',
      role: '相府千金',
      note: '情敌，善于伪装，多次设局陷害女主'
    },
    { name: '太后', faction: 'neutral', role: '后宫之主', note: '立场摇摆，掌握女主身世关键' }
  ],
  foreshadowings: [
    {
      title: '上元灯会救命之恩的真正恩人',
      payoffHint: '第 {start}~{end} 章揭晓当年救人者身份，消除第一次误会'
    },
    { title: '侯府没落与母亲早逝之谜', payoffHint: '第 {start}~{end} 章查明侯府被构陷的真相' },
    {
      title: '先帝密诏与女主真实身世',
      payoffHint: '全书后期（第 {start}~{end} 章）揭晓身世并完成身份逆转'
    }
  ],
  polish: {
    slapZh: '强化眼神拉扯与情绪张力',
    slapEn: 'Heighten Emotional Tension',
    expandZh: '扩写心理与细节描写 (+300字)',
    expandEn: 'Expand Inner Feelings',
    fixZh: '修正关系进度越级',
    fixEn: 'Fix Relationship Pacing',
    hookZh: '改写为情感悬念钩子',
    hookEn: 'Rewrite as Emotional Hook',
    slapAddonZh:
      '四目相对的一瞬，周遭喧嚣仿佛都远去了。他看着她手中的【{unlock}】，眼底翻涌的情绪终于再也藏不住。',
    expandAddonZh:
      '烛火轻轻摇曳，她垂眸望着杯中浮动的茶叶，心口像被什么轻轻攥住。【{stage}】的微妙距离，让每一句寻常话都带上了别样的温度。',
    hookAddonZh: '可就在她转身的刹那，身后传来一声低唤——那是只有【{item}】那夜才有人叫过的名字。'
  },
  styleDirectiveZh:
    '言情/宫斗：情绪细腻、张力克制，重视眼神与细节；关系进展需循序渐进，误会须有合理动机；宫斗权谋讲究布局与反制。',
  styleDirectiveEn:
    'Romance/palace: nuanced emotions, restrained tension, gradual relationship progress, plausible misunderstandings.',
  worldBibleSeedZh: [
    '- 情感铁律：关系阶段依次推进（陌路→情愫→心动→误会→分离→真相→相守），严禁无铺垫的突然告白或和好。',
    '- 女主核心底色：聪慧坚韧、有主见，不恋爱脑，不依赖男主拯救。'
  ],
  hookKeywordsRe: '忽然|骤然|低唤|圣旨|婚约|转身|心口|眼眶|密信|身世|究竟|为何|门外'
}

const SCIFI: NovelGenreProfile = {
  id: 'scifi_apocalypse',
  labelZh: '科幻星际 / 末日废土',
  labelEn: 'Sci-Fi & Apocalypse',
  icon: '🚀',
  volumeThemesZh: [
    '灾变元年 · 城市沦陷与求生',
    '庇护所 · 资源争夺与基因觉醒',
    '废土割据 · 势力崛起与科技复兴',
    '母巢暗影 · 异种进化与反攻',
    '星轨破壁 · 离开母星',
    '星际边疆 · 文明接触',
    '降维危机 · 高等文明来袭',
    '文明火种 · 终局与新生'
  ],
  stageNamesZh: [
    '幸存者',
    'D级觉醒者',
    'C级进化者',
    'B级战术指挥',
    'A级据点领主',
    'S级区域霸主',
    '星际舰长',
    '文明执剑人'
  ],
  stageTermZh: '进化等级/文明阶段',
  stageTermEn: 'Evolution Tier',
  protagonistAxisZh: '科技算力/生存武装',
  protagonistAxisEn: 'Tech & Arms',
  antagonistAxisZh: '灾变/异种威胁',
  antagonistAxisEn: 'Catastrophe Threat',
  unlockTermZh: '火种科技',
  unlockTermEn: 'Seed Tech',
  encounterTermZh: '物资/遗迹',
  unlockItemsZh: [
    '改装电磁步枪',
    '基因锁一阶解封',
    '废墟中的军用外骨骼',
    '聚变反应堆核心',
    '曲率引擎原型'
  ],
  encounterItemsZh: [
    '一箱抗辐射药剂',
    '失落实验室的数据核心',
    '异种晶核',
    '旧时代卫星控制权限',
    '外星信标碎片'
  ],
  beats: {
    setup_endure: {
      badgeZh: '求生积累',
      badgeEn: 'Survival Build-up',
      labelZh: '求生与积累期（资源匮乏、环境恶劣，主角规划生存路线并积累物资，严禁无代价碾压）',
      titleZh: '废墟求生·{item}',
      titleEn: 'Surviving the Ruins',
      coreConflictZh: '主角处于【{stage}】，在辐射区边缘搜寻{item}，与其他幸存者小队周旋。',
      cliffhangerZh: '夜色中，远处传来不属于任何已知异种的嘶鸣，信号屏上出现了一个移动的巨大热源。'
    },
    encounter_growth: {
      badgeZh: '科技突破',
      badgeEn: 'Tech Breakthrough',
      labelZh: '科技突破期（获得遗迹/实验数据，解锁新科技或进化，建立局部优势）',
      titleZh: '遗迹解码·{unlock}上线',
      titleEn: 'Relic Decoded',
      coreConflictZh:
        '主角破解遗迹数据获得【{unlock}】，生存武装升至 {ceiling}，击退前来抢夺的掠夺者。',
      cliffhangerZh: '数据核心中残留的最后一段影像显示：灾变并非意外，而是一场“实验”。'
    },
    villain_suppression_cliffhanger: {
      badgeZh: '尸潮压境',
      badgeEn: 'Horde Assault',
      labelZh: '灾变压境期（异种潮/敌对势力以压倒性威胁围攻据点，章末留绝地反击悬念）',
      titleZh: '尸潮围城·防线告急（威胁 {pressure}）',
      titleEn: 'The Horde at the Walls',
      coreConflictZh: '威胁等级 {pressure} 的异种潮淹没外围防线，弹药告罄，据点只剩最后一道闸门。',
      cliffhangerZh: '主角按下了从未测试过的【{unlock}】启动键，整座城市的电网同时亮起。'
    },
    climax_reversal_slap: {
      badgeZh: '绝地反攻',
      badgeEn: 'Counter-Offensive',
      labelZh: '绝地反攻期（以本阶段火种科技逆转战局，重创威胁源，扩大文明版图）',
      titleZh: '火种燎原·{unlock}',
      titleEn: 'The Seed Ignites',
      coreConflictZh:
        '主角调动【{unlockTop}】发起反攻，科技算力爆发至 {ceiling}，一举摧毁异种母巢前哨。',
      cliffhangerZh: '母巢残骸深处，一枚仍在闪烁的外星信标正向深空发送坐标。'
    }
  },
  roster: [
    {
      name: '陈默',
      faction: 'protagonist',
      role: '前军工工程师',
      note: '主角，冷静务实，掌握旧时代技术知识'
    },
    { name: '叶琳', faction: 'ally', role: '狙击手/队副', note: '可靠战友，负责侦察与远程支援' },
    { name: '铁狼', faction: 'villain', role: '掠夺者首领', note: '控制北区黑市，觊觎主角的技术' },
    { name: '母巢意识', faction: 'villain', role: '异种集群智能', note: '不断进化的终极威胁' }
  ],
  foreshadowings: [
    {
      title: '灾变起源的“实验”影像',
      payoffHint: '第 {start}~{end} 章找到实验负责人，揭晓灾变起因'
    },
    {
      title: '旧时代卫星与失联的轨道站',
      payoffHint: '第 {start}~{end} 章重启轨道站，获得离开母星的可能'
    },
    {
      title: '外星信标与高等文明的注视',
      payoffHint: '全书后期（第 {start}~{end} 章）与高等文明正面接触'
    }
  ],
  polish: {
    slapZh: '强化战斗场面与科技震撼',
    slapEn: 'Boost Combat & Tech Awe',
    expandZh: '扩写废土环境与科技细节 (+300字)',
    expandEn: 'Expand Wasteland Details',
    fixZh: '修正科技越级与违规装备',
    fixEn: 'Fix Tech Overreach',
    hookZh: '改写为危机悬念钩子',
    hookEn: 'Rewrite as Crisis Hook',
    slapAddonZh:
      '电弧撕裂夜空，【{unlock}】释放的能量将整条街道照得雪亮。幸存者们呆立在掩体后，看着成片的异种在光芒中化为焦炭。',
    expandAddonZh:
      '铁锈与焦油的气味混杂在辐射尘里，盖革计数器发出急促的咔嗒声。【{stage}】的装备在 {pressure} 级威胁面前显得如此单薄。',
    hookAddonZh: '通讯器里突然传出一段断续的求救信号，坐标指向——早已被宣布摧毁的【{item}】所在地。'
  },
  styleDirectiveZh:
    '科幻末日：科技设定自洽、资源与代价真实，突出生存压力与人性抉择；战斗讲究战术与装备逻辑。',
  styleDirectiveEn:
    'Sci-fi/apocalypse: consistent tech rules, real scarcity and costs, survival pressure and moral choices.',
  worldBibleSeedZh: [
    '- 科技铁律：所有科技与进化能力需有来源与能耗/副作用，严禁凭空出现超越当前文明阶段的装备。',
    '- 主角核心底色：理性务实、重视同伴，在生存与道德之间艰难抉择。'
  ],
  hookKeywordsRe: '忽然|骤然|信号|警报|嘶鸣|热源|坐标|爆炸|倒计时|失联|究竟|门外'
}

const LOVECRAFT: NovelGenreProfile = {
  id: 'lovecraft_rules',
  labelZh: '规则怪谈 / 克苏鲁无限流',
  labelEn: 'Rule Horror & Cosmic Dread',
  icon: '👁️',
  volumeThemesZh: [
    '第一副本 · 规则之下的公寓',
    '里世界 · 污染与扭曲',
    '低语 · 不可名状的注视',
    '悖论 · 规则之间的矛盾',
    '收容 · 调查局与禁忌遗物',
    '深潜 · 古神沉睡之地',
    '真名 · 旧日支配者',
    '归途 · 理智的代价'
  ],
  stageNamesZh: [
    '新人调查员',
    '规则辨识者',
    '污染抵抗者',
    '悖论解析者',
    '禁忌收容者',
    '深渊行者',
    '真名持有者'
  ],
  stageTermZh: '调查员阶位',
  stageTermEn: 'Investigator Rank',
  protagonistAxisZh: '理智值/破局解析度',
  protagonistAxisEn: 'Sanity & Insight',
  antagonistAxisZh: '诡异污染度',
  antagonistAxisEn: 'Eldritch Corruption',
  unlockTermZh: '禁忌遗物/规则漏洞',
  unlockTermEn: 'Relics & Loopholes',
  encounterTermZh: '规则线索',
  unlockItemsZh: [
    '被涂改过的员工守则',
    '一面不映出背后的镜子',
    '褪色的守夜人怀表',
    '刻有星辰的黑曜石碎片',
    '旧日支配者的半个真名'
  ],
  encounterItemsZh: [
    '前一位住户的日记',
    '一张手绘楼层平面图',
    '只在午夜出现的第13层按钮',
    '褪色照片里多出的人影',
    '一段倒放的广播'
  ],
  beats: {
    setup_endure: {
      badgeZh: '规则初现',
      badgeEn: 'Rules Emerge',
      labelZh: '规则初现期（呈现规则与异常，营造不安感，主角谨慎试探，严禁直接击败诡异）',
      titleZh: '守则第一条·{item}',
      titleEn: 'Rule Number One',
      coreConflictZh: '主角处于【{stage}】，在{item}中发现规则存在细微矛盾，周围人开始出现异样。',
      cliffhangerZh: '凌晨三点，敲门声准时响起——而守则上写着：“绝不要回应第三次敲门。”'
    },
    encounter_growth: {
      badgeZh: '线索解析',
      badgeEn: 'Clue Analysis',
      labelZh: '线索解析期（拼凑线索、识别真假规则，获得遗物或漏洞，暂时稳住理智）',
      titleZh: '真假守则·{unlock}',
      titleEn: 'True and False Rules',
      coreConflictZh:
        '主角辨识出伪造的规则，获得【{unlock}】，破局解析度升至 {ceiling}，带领幸存者躲过一次“清理”。',
      cliffhangerZh: '镜子里的自己慢了半拍才眨眼。'
    },
    villain_suppression_cliffhanger: {
      badgeZh: '污染侵蚀',
      badgeEn: 'Corruption Spreads',
      labelZh: '污染侵蚀期（诡异污染度飙升，同伴异化，规则互相矛盾，主角理智濒临崩溃）',
      titleZh: '低语渐近·理智崩坏（污染 {pressure}）',
      titleEn: 'The Whispers Draw Near',
      coreConflictZh:
        '污染度升至 {pressure}，同伴开始复述不属于人类的语言，两条规则出现无法同时遵守的悖论。',
      cliffhangerZh: '在理智归零前的一秒，主角想起了【{unlock}】上那行几乎被磨平的小字。'
    },
    climax_reversal_slap: {
      badgeZh: '悖论破局',
      badgeEn: 'Paradox Broken',
      labelZh: '悖论破局期（利用规则漏洞与遗物破解副本核心，付出理智代价，暂时脱离）',
      titleZh: '以规则破规则·{unlock}',
      titleEn: 'Breaking Rules with Rules',
      coreConflictZh:
        '主角以【{unlockTop}】利用规则悖论反制诡异，破局解析度达到 {ceiling}，副本核心崩塌，但永久失去了一段记忆。',
      cliffhangerZh: '回到现实后，主角发现自家门上贴着一张新的守则，落款是他自己的笔迹。'
    }
  },
  roster: [
    {
      name: '江夜',
      faction: 'protagonist',
      role: '新人调查员',
      note: '主角，逻辑缜密、记忆力超群，对规则异常敏感'
    },
    { name: '白鸦', faction: 'ally', role: '资深收容员', note: '神秘向导，似乎经历过无数副本' },
    {
      name: '管理员',
      faction: 'neutral',
      role: '副本规则执行者',
      note: '态度时好时坏，似乎有自己的目的'
    },
    { name: '“它”', faction: 'villain', role: '不可名状之物', note: '沉睡在副本最深处的古老存在' }
  ],
  foreshadowings: [
    {
      title: '前一位住户日记的最后一页',
      payoffHint: '第 {start}~{end} 章找到缺失的最后一页，破解第一副本'
    },
    { title: '白鸦的真实身份与失去的记忆', payoffHint: '第 {start}~{end} 章揭示白鸦与主角的过去' },
    {
      title: '旧日支配者的完整真名',
      payoffHint: '全书后期（第 {start}~{end} 章）拼凑完整真名，完成终局封印'
    }
  ],
  polish: {
    slapZh: '强化破局反转与诡异溃散',
    slapEn: 'Boost Paradox Reversal',
    expandZh: '扩写诡异氛围与感官异常 (+300字)',
    expandEn: 'Expand Uncanny Atmosphere',
    fixZh: '修正提前动用的禁忌遗物',
    fixEn: 'Fix Premature Relics',
    hookZh: '改写为毛骨悚然钩子',
    hookEn: 'Rewrite as Chilling Hook',
    slapAddonZh:
      '规则崩塌的声音像玻璃碎裂。【{unlock}】在掌心发烫，走廊尽头那团扭曲的影子发出无声的尖啸，一寸寸褪色、剥落。',
    expandAddonZh:
      '灯光以一种不自然的频率闪烁，墙纸的花纹在余光里缓慢蠕动。空气中弥漫着潮湿的铁锈味，【{stage}】的理智屏障在 {pressure} 的污染下发出细微的裂响。',
    hookAddonZh:
      '主角低头，发现手中的【{item}】上，不知何时多了一行新的字迹：“你已经违反过一次了。”'
  },
  styleDirectiveZh:
    '规则怪谈/克苏鲁：以未知和规则矛盾制造恐惧，克制描写、留白暗示；破局依赖逻辑与规则漏洞，并伴随理智代价。',
  styleDirectiveEn:
    'Rule horror/cosmic: fear via the unknown and rule contradictions, restrained suggestion, logic-based escapes with sanity costs.',
  worldBibleSeedZh: [
    '- 规则铁律：诡异不可被正面击杀，只能通过遵守/利用规则或禁忌遗物规避与封印；每次破局必须付出理智或记忆代价。',
    '- 主角核心底色：冷静多疑、逻辑至上，在恐惧中保持理性。'
  ],
  hookKeywordsRe: '忽然|骤然|敲门|镜子|低语|眨眼|守则|规则|字迹|影子|究竟|身后|门外'
}

const HISTORICAL: NovelGenreProfile = {
  id: 'historical_intrigue',
  labelZh: '历史架空 / 朝堂权谋',
  labelEn: 'Historical Intrigue',
  icon: '👑',
  volumeThemesZh: [
    '寒门入仕 · 科场风波',
    '县令新政 · 地方豪强',
    '京城暗涌 · 党争初现',
    '九龙夺嫡 · 站队与布局',
    '北境烽烟 · 兵权之争',
    '内阁首辅 · 变法与反扑',
    '定鼎天下 · 平叛与北伐',
    '千秋功过 · 盛世与身后名'
  ],
  stageNamesZh: [
    '寒门书生',
    '七品县令',
    '五品知府',
    '三品侍郎',
    '一品尚书',
    '内阁首辅',
    '摄政辅国'
  ],
  stageTermZh: '官阶品级',
  stageTermEn: 'Official Rank',
  protagonistAxisZh: '朝堂权势/民心国力',
  protagonistAxisEn: 'Court Power',
  antagonistAxisZh: '门阀/外敌压力',
  antagonistAxisEn: 'Faction & Foreign Pressure',
  unlockTermZh: '权谋筹码',
  unlockTermEn: 'Political Leverage',
  encounterTermZh: '人脉/情报',
  unlockItemsZh: [
    '一本记满账目的私账',
    '御史台的弹劾奏折',
    '边军将领的效忠书',
    '先帝遗留的密诏',
    '虎符与京营兵权'
  ],
  encounterItemsZh: [
    '落魄老吏的指点',
    '一份盐铁专营的旧档',
    '江湖密探网',
    '番邦使节的私信',
    '新式火器图纸'
  ],
  beats: {
    setup_endure: {
      badgeZh: '蛰伏布局',
      badgeEn: 'Patient Scheming',
      labelZh: '蛰伏布局期（身处弱势，暗中积累人脉与证据，隐忍示弱，严禁无凭据正面硬刚）',
      titleZh: '韬光养晦·{item}',
      titleEn: 'Biding Time',
      coreConflictZh: '主角身为【{stage}】，被权贵刁难，借{item}暗中收集对方把柄，表面恭顺。',
      cliffhangerZh: '深夜，一封盖着东宫印信的密函被悄悄塞进了主角的书房。'
    },
    encounter_growth: {
      badgeZh: '借势而起',
      badgeEn: 'Rising on Leverage',
      labelZh: '借势而起期（获得关键人物支持或情报，推行局部新政，初步建立声望）',
      titleZh: '借势破局·{unlock}',
      titleEn: 'Leverage Gained',
      coreConflictZh:
        '主角得到【{unlock}】，朝堂权势升至 {ceiling}，以新政整顿积弊，赢得民心与上峰赏识。',
      cliffhangerZh: '新政推行的第三日，主角的恩师被人以谋逆之名下了诏狱。'
    },
    villain_suppression_cliffhanger: {
      badgeZh: '党争围剿',
      badgeEn: 'Factional Assault',
      labelZh: '党争围剿期（门阀联合发难，弹劾、构陷、断粮，主角陷入绝境，章末留反制伏笔）',
      titleZh: '满朝弹劾·危如累卵（压力 {pressure}）',
      titleEn: 'Impeached by the Court',
      coreConflictZh:
        '世家门阀联名弹劾，压力升至 {pressure}，皇帝态度不明，主角被软禁府中，党羽纷纷倒戈。',
      cliffhangerZh: '软禁第七日，主角让老仆将【{unlock}】连夜送出城外。'
    },
    climax_reversal_slap: {
      badgeZh: '金殿反制',
      badgeEn: 'Throne Room Reversal',
      labelZh: '金殿反制期（于朝堂之上抛出权谋筹码，一举扳倒政敌，品级与权势跃升）',
      titleZh: '金殿对质·{unlock}',
      titleEn: 'Confrontation in the Golden Hall',
      coreConflictZh:
        '大朝会上，主角当庭呈上【{unlockTop}】，朝堂权势跃升至 {ceiling}，政敌伏法，满朝噤声。',
      cliffhangerZh: '退朝时，一直沉默的三皇子在主角耳边轻声道：“下一个，会是谁呢？”'
    }
  },
  roster: [
    {
      name: '顾清和',
      faction: 'protagonist',
      role: '寒门进士',
      note: '主角，学识渊博、心思缜密，胸怀变法之志'
    },
    { name: '周老', faction: 'ally', role: '致仕老臣', note: '主角恩师，熟谙朝堂规则' },
    { name: '王丞相', faction: 'villain', role: '世家门阀领袖', note: '把持朝政，视新政为眼中钉' },
    { name: '三皇子', faction: 'neutral', role: '夺嫡热门', note: '城府极深，对主角时拉时打' }
  ],
  foreshadowings: [
    { title: '东宫密函的真正来意', payoffHint: '第 {start}~{end} 章揭示密函背后的夺嫡布局' },
    { title: '盐铁旧档中的贪墨大案', payoffHint: '第 {start}~{end} 章揭开大案，扳倒门阀羽翼' },
    { title: '先帝密诏与皇位正统之争', payoffHint: '全书后期（第 {start}~{end} 章）以密诏定鼎朝局' }
  ],
  polish: {
    slapZh: '强化朝堂反制与满朝震动',
    slapEn: 'Boost Court Reversal',
    expandZh: '扩写朝堂礼制与权谋细节 (+300字)',
    expandEn: 'Expand Court Details',
    fixZh: '修正权谋筹码提前暴露',
    fixEn: 'Fix Premature Leverage',
    hookZh: '改写为权谋悬念钩子',
    hookEn: 'Rewrite as Intrigue Hook',
    slapAddonZh:
      '金殿之上落针可闻。当【{unlock}】被内侍高声宣读，王丞相手中的笏板“啪”地落地，满朝文武无一人敢抬头。',
    expandAddonZh:
      '晨钟三响，百官按品级鱼贯入殿，朱红宫墙在晨雾中显得格外肃穆。【{stage}】的位置不前不后，恰好能看清每一张或谄媚或阴沉的脸，以及高达 {pressure} 的暗流。',
    hookAddonZh:
      '回府途中，轿帘被风掀起一角，主角瞥见街角那人腰间悬着的，正是失踪多年的【{item}】。'
  },
  styleDirectiveZh:
    '历史权谋：讲究布局与反制、人物动机复杂；遵循礼制与官场逻辑，权力斗争需有证据与筹码，避免无脑开挂。',
  styleDirectiveEn:
    'Historical intrigue: layered schemes and counter-schemes, complex motives, consistent court etiquette and logic.',
  worldBibleSeedZh: [
    '- 权谋铁律：官阶晋升与扳倒政敌必须依赖证据、人脉与时机，皇权与门阀之间存在制衡；严禁无凭据的降维碾压。',
    '- 主角核心底色：隐忍深谋、心系苍生，手段果决但有底线。'
  ],
  hookKeywordsRe: '忽然|骤然|密函|诏狱|圣旨|轻声|耳边|弹劾|究竟|谋逆|兵变|门外'
}

const CUSTOM: NovelGenreProfile = {
  id: 'custom_literary',
  labelZh: '自定义题材 / 严肃文学',
  labelEn: 'Custom / Literary',
  icon: '✒️',
  volumeThemesZh: [
    '序章 · 起点',
    '展开 · 关系建立',
    '转折 · 冲突浮现',
    '低谷 · 失去与追问',
    '回响 · 重新出发',
    '高潮 · 选择与代价',
    '余韵 · 和解',
    '终章 · 归处'
  ],
  stageNamesZh: ['起点', '觉察', '投入', '动摇', '低谷', '觉醒', '抉择', '归处'],
  stageTermZh: '人物弧光阶段',
  stageTermEn: 'Character Arc Stage',
  protagonistAxisZh: '成长/掌控度',
  protagonistAxisEn: 'Growth',
  antagonistAxisZh: '内外阻力',
  antagonistAxisEn: 'Resistance',
  unlockTermZh: '关键转折',
  unlockTermEn: 'Key Turning Points',
  encounterTermZh: '关键事件',
  unlockItemsZh: [
    '一次坦诚的对话',
    '一封迟到的信',
    '一个被重新理解的旧物',
    '一次彻底的放手',
    '最终的选择'
  ],
  encounterItemsZh: [
    '一场突如其来的雨',
    '一位旧友的来访',
    '一段被遗忘的记忆',
    '一次远行',
    '一个陌生人的善意'
  ],
  beats: {
    setup_endure: {
      badgeZh: '铺陈',
      badgeEn: 'Setup',
      labelZh: '铺陈期（建立人物处境与内在渴望，埋下矛盾种子，克制叙述）',
      titleZh: '{item}',
      titleEn: 'Setup',
      coreConflictZh: '主人公处于【{stage}】，日常中的{item}触动了长久压抑的情绪。',
      cliffhangerZh: '一个微小却无法忽视的变化，让主人公意识到生活已无法回到原样。'
    },
    encounter_growth: {
      badgeZh: '推进',
      badgeEn: 'Development',
      labelZh: '推进期（人物主动行动，关系与处境发生变化，获得新的理解）',
      titleZh: '{unlock}',
      titleEn: 'Development',
      coreConflictZh:
        '主人公经历【{unlock}】，成长度升至 {ceiling}，与重要他人的关系出现新的可能。',
      cliffhangerZh: '然而新的理解也带来新的疑问，一个被回避的问题浮出水面。'
    },
    villain_suppression_cliffhanger: {
      badgeZh: '危机',
      badgeEn: 'Crisis',
      labelZh: '危机期（内外阻力达到顶点，人物信念动摇，面临艰难抉择）',
      titleZh: '阻力 {pressure}',
      titleEn: 'Crisis',
      coreConflictZh: '阻力升至 {pressure}，主人公失去重要的依靠，被迫直面自己最害怕的部分。',
      cliffhangerZh: '在最低谷，主人公想起了【{unlock}】所代表的意义。'
    },
    climax_reversal_slap: {
      badgeZh: '转变',
      badgeEn: 'Transformation',
      labelZh: '转变期（人物做出关键选择，完成阶段性的成长与和解）',
      titleZh: '{unlock}',
      titleEn: 'Transformation',
      coreConflictZh:
        '主人公借由【{unlockTop}】做出选择，成长度达到 {ceiling}，与自我或他人达成和解。',
      cliffhangerZh: '尘埃落定，但生活的下一道题已经悄然摆在面前。'
    }
  },
  roster: [
    {
      name: '主人公',
      faction: 'protagonist',
      role: '叙事核心',
      note: '请在人物名录中改为你的主角'
    },
    { name: '重要他人', faction: 'ally', role: '情感支点', note: '与主人公关系最密切的人' },
    { name: '对立者', faction: 'villain', role: '外部阻力', note: '与主人公目标冲突的人或力量' }
  ],
  foreshadowings: [
    { title: '开篇的那件旧物', payoffHint: '第 {start}~{end} 章揭示旧物背后的故事' },
    { title: '主人公回避的往事', payoffHint: '第 {start}~{end} 章直面往事' },
    { title: '贯穿全书的核心追问', payoffHint: '全书后期（第 {start}~{end} 章）给出回答' }
  ],
  polish: {
    slapZh: '强化情绪爆发与转折力度',
    slapEn: 'Intensify Turning Point',
    expandZh: '扩写环境与内心描写 (+300字)',
    expandEn: 'Expand Setting & Interior',
    fixZh: '修正提前出现的转折',
    fixEn: 'Fix Premature Turns',
    hookZh: '改写为余韵悬念结尾',
    hookEn: 'Rewrite as Resonant Ending',
    slapAddonZh:
      '那一刻，所有压抑已久的情绪终于找到了出口。【{unlock}】像一道光，照亮了一直不敢看清的地方。',
    expandAddonZh:
      '窗外的光线一点点暗下去，屋子里只剩下钟表的滴答声。【{stage}】的心境，让每一件寻常的物件都显得意味深长。',
    hookAddonZh: '合上门的时候，主人公忽然想起了【{item}】——原来答案一直都在那里。'
  },
  styleDirectiveZh:
    '自定义/文学：尊重用户设定的阶段与轴名称，以人物内在变化驱动情节，叙述克制、细节真实。',
  styleDirectiveEn:
    'Custom/literary: follow the user-defined stages and axes, character-driven, restrained and concrete.',
  worldBibleSeedZh: ['- 叙事铁律：人物的每一次转变都需要铺垫与代价，避免突兀的情节跳跃。'],
  hookKeywordsRe: '忽然|骤然|原来|想起|为什么|究竟|最后|答案|门外'
}

export const NOVEL_GENRE_PROFILES: NovelGenreProfile[] = [
  URBAN,
  XIANXIA,
  MYSTERY,
  ROMANCE,
  SCIFI,
  LOVECRAFT,
  HISTORICAL,
  CUSTOM
]

export const NOVEL_GENRE_IDS: NovelGenreId[] = NOVEL_GENRE_PROFILES.map((p) => p.id)

export function isNovelGenreId(raw: unknown): raw is NovelGenreId {
  return typeof raw === 'string' && (NOVEL_GENRE_IDS as string[]).includes(raw)
}

/**
 * 解析流派模板；`custom_literary` 或任何流派均可被用户自定义覆写阶段序列 / 轴名称 / 解锁物名称。
 * 未指定流派时返回 `undefined`（保持旧版都市逆袭行为不变）。
 */
export function resolveNovelGenreProfile(
  genreId?: string | null,
  custom?: NovelGenreCustomOverrides
): NovelGenreProfile | undefined {
  if (!genreId || !isNovelGenreId(genreId)) return undefined
  const base = NOVEL_GENRE_PROFILES.find((p) => p.id === genreId) ?? URBAN
  const stages = (custom?.stagesText ?? '')
    .split(/[,，、\n;；|]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const axisP = custom?.axisProtagonist?.trim()
  const axisA = custom?.axisAntagonist?.trim()
  const unlock = custom?.unlockTerm?.trim()
  if (!stages.length && !axisP && !axisA && !unlock) return base
  return {
    ...base,
    ...(stages.length ? { stageNamesZh: stages } : {}),
    ...(axisP ? { protagonistAxisZh: axisP, protagonistAxisEn: axisP } : {}),
    ...(axisA ? { antagonistAxisZh: axisA, antagonistAxisEn: axisA } : {}),
    ...(unlock ? { unlockTermZh: unlock, unlockTermEn: unlock } : {})
  }
}

/** 从一句话描述推断流派（未命中返回 undefined） */
export function inferNovelGenreFromText(text: string): NovelGenreId | undefined {
  const t = (text ?? '').toLowerCase()
  if (!t.trim()) return undefined
  if (/修仙|修真|仙侠|玄幻|筑基|金丹|元婴|渡劫|宗门|灵根|xianxia|cultivation/.test(t))
    return 'xianxia_cultivation'
  if (/规则怪谈|克苏鲁|怪谈|无限流|古神|san值|理智值|lovecraft|eldritch/.test(t))
    return 'lovecraft_rules'
  if (/悬疑|推理|刑侦|侦探|凶手|密室|命案|mystery|detective/.test(t)) return 'mystery_detective'
  if (/宫斗|言情|古言|甜宠|虐恋|王妃|侯府|romance|palace/.test(t)) return 'romance_palace'
  if (/末日|废土|丧尸|星际|科幻|机甲|异种|apocalypse|sci-?fi|space/.test(t))
    return 'scifi_apocalypse'
  if (/权谋|朝堂|架空|夺嫡|首辅|科举|historical|intrigue/.test(t)) return 'historical_intrigue'
  if (/都市|赘婿|战神|神豪|退婚|逆袭|打脸|urban/.test(t)) return 'urban_reversal'
  return undefined
}

export interface NovelGenreOfflineChapterOptions {
  currentChapter: number
  totalChapters: number
  targetWords: number
  stage: string
  ceiling: string | number
  pressure: string | number
  allowed: string
  locked: string
  item: string
  beatLabel: string
  volumeLabel: string
  prevTailAnchor?: string
  protagonistName?: string
}

/** 无模型离线兜底：按流派语义生成一章四拍结构样章（保证测试 / 无 API 环境下流派风格正确） */
export function synthesizeGenreNovelChapterOffline(
  profile: NovelGenreProfile,
  o: NovelGenreOfflineChapterOptions
): string {
  const name = o.protagonistName?.trim() || profile.roster[0]?.name || '主人公'
  const ally = profile.roster.find((r) => r.faction === 'ally')?.name || '同伴'
  const foe = profile.roster.find((r) => r.faction === 'villain')?.name || '对手'
  const vars = {
    stage: o.stage,
    item: o.item,
    unlock: o.allowed.split(/[、,]/)[0]?.replace(/[【】]/g, '') || o.allowed,
    unlockTop: o.allowed,
    pressure: o.pressure,
    ceiling: o.ceiling,
    lockedTop: o.locked
  }
  const beatOrder: NovelGenreBeatType[] = [
    'setup_endure',
    'encounter_growth',
    'villain_suppression_cliffhanger',
    'climax_reversal_slap'
  ]
  const headBeat = profile.beats[beatOrder[(o.currentChapter - 1) % 4]!]
  const chapTitle = `${fillNovelGenreTemplate(headBeat.titleZh, vars)}（第 ${o.currentChapter}/${o.totalChapters} 章 · ${o.stage}）`
  const prevHook = o.prevTailAnchor?.trim()
    ? `承接第 ${o.currentChapter - 1} 章末尾余波（“${o.prevTailAnchor.trim().slice(-120)}”），`
    : ''
  const b = profile.beats
  return [
    `小说名：《${profile.labelZh.split(' / ')[0]}·长篇连载》`,
    ``,
    `【核心设定与人物档案】`,
    `- 流派：${profile.labelZh}（全书动态总章数：${o.totalChapters} 章 · 当前连载进度：第 ${o.currentChapter}/${o.totalChapters} 章）`,
    `- 所属篇章：${o.volumeLabel} · 当前${profile.stageTermZh}【${o.stage}】· ${profile.protagonistAxisZh} ${o.ceiling} vs ${profile.antagonistAxisZh} ${o.pressure}`,
    `- 本章可用${profile.unlockTermZh}：${o.allowed}（封存：${o.locked}）`,
    ...profile.roster.map((r) => `- ${r.name}（${r.role}）：${r.note}`),
    ``,
    `第${o.currentChapter}章：${chapTitle}`,
    `【第一拍 · ${b.setup_endure.badgeZh}】`,
    `${prevHook}${name}${fillNovelGenreTemplate(b.setup_endure.coreConflictZh, vars).replace(/^主角|^主人公|^二人/, '')}按照本章节拍（${o.beatLabel}），${name}没有急于动用仍处于封存状态的${profile.unlockTermZh}（${o.locked}），而是把每一个细节都记在心里。`,
    ``,
    `【第二拍 · ${b.encounter_growth.badgeZh}】`,
    `${ally}带来了新的消息，局势出现了转机。${fillNovelGenreTemplate(b.encounter_growth.coreConflictZh, vars)}`,
    ``,
    `【第三拍 · ${b.villain_suppression_cliffhanger.badgeZh}】`,
    `${foe}的反扑来得比预想更快。${fillNovelGenreTemplate(b.villain_suppression_cliffhanger.coreConflictZh, vars)}${fillNovelGenreTemplate(b.villain_suppression_cliffhanger.cliffhangerZh, vars)}`,
    ``,
    `【第四拍 · ${b.climax_reversal_slap.badgeZh}】`,
    `${fillNovelGenreTemplate(b.climax_reversal_slap.coreConflictZh, vars)}${fillNovelGenreTemplate(b.climax_reversal_slap.cliffhangerZh, vars)}（目标字数规格：${o.targetWords}+ 字，静待第 ${Math.min(o.totalChapters, o.currentChapter + 1)} 章继续连载推进）`
  ].join('\n')
}

/** 写入提示词的流派风格指令块 */
export function buildNovelGenreDirectiveBlock(profile: NovelGenreProfile, locale?: string): string {
  const en = (locale ?? '').toLowerCase().startsWith('en')
  if (en) {
    return [
      `### [Genre Profile: ${profile.labelEn}]`,
      `- Style: ${profile.styleDirectiveEn}`,
      `- Semantic mapping: "Realm" = ${profile.stageTermEn}; "Power" = ${profile.protagonistAxisEn}; "Villain Pressure" = ${profile.antagonistAxisEn}; "Trump Cards" = ${profile.unlockTermEn}.`,
      `- Stage ladder: ${profile.stageNamesZh.join(' → ')}`
    ].join('\n')
  }
  return [
    `### [小说流派与题材语义 (Genre Profile)：${profile.icon} ${profile.labelZh}]`,
    `- 写作风格：${profile.styleDirectiveZh}`,
    `- 数值语义映射：本书中「境界」= ${profile.stageTermZh}；「战力」= ${profile.protagonistAxisZh}；「反派压迫」= ${profile.antagonistAxisZh}；「底牌」= ${profile.unlockTermZh}；「奇遇信物」= ${profile.encounterTermZh}。请全程使用本流派语言，严禁混入其他题材（如都市豪门、修仙境界）的词汇。`,
    `- ${profile.stageTermZh}阶梯：${profile.stageNamesZh.join(' → ')}`
  ].join('\n')
}
