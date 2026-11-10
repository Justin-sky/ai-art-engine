/**
 * 小说 (`asset.novel`) + 经济系统 (`game.economy`) + 游戏系统策划案 (`asset.gameSystem`) 全链路闭环桥接引擎
 *
 * 核心职责：
 * 1. 定义 8 大游戏系统策划品类模板（`GAME_SYSTEM_ARCHETYPES`），与小说 8 大流派及经济系统 6 大预设自动对齐；
 * 2. `unwrapEconomyBundleForGameSystem`：将上游 `game.economy` 的乘区公式、实体预算表、抽卡保底/副属性分布、战斗内核与成长包络解包为【系统策划数值与 UI 绑定白皮书】；
 * 3. `extractNovelIpContextForGameSystem`：将上游 `asset.novel` 的流派阶梯、L1 世界观宪法、人物生死名录、法宝/证据信物池及已写章节转译为【IP 改编系统玩法与关卡映射规格】；
 * 4. `synthesizeGameSystemDocOffline`：在无大模型 API 或确定性测试环境下，融合经济系统与小说 IP 产出可直接交由下游 `ui.split` 拆分的工程级系统策划案；
 * 5. `auditGameSystemDocument`：实时审计系统策划案的 6 大工程维度（章节完备度、P0/P1 与异常边界、数值公式闭环、IP 映射、ASCII 界面框线与 9-slice PSD 规范）并提取 UI 界面拆分预检卡片。
 */

import {
  analyzeMultiplierPipeline,
  createMxWorkbenchPreset,
  normalizeMxNumericalWorkbench,
  normalizeNovelCharacterRoster,
  normalizeNovelForeshadowingPool,
  runMxCombatKernelSimulation,
  runMxLootAndSubstatSimulation,
  runMxRoguelikeEnvelopeSimulation,
  solveMxSingleTurnLethalAndOrderSkill,
  type MxDomainDataTable,
  type MxDomainFormulaRule,
  type MxDomainNumericalSuite,
  type MxDomainTableColumn,
  type MxNovelCharacterStatusEntry,
  type MxNovelForeshadowingEntry,
  type MxNumericalWorkbench
} from './gameNumericalWorkbench'
import {
  inferNovelGenreFromText,
  resolveNovelGenreProfile,
  type NovelGenreId
} from './novelGenreProfiles'
import type { MxTemplateId } from './machinationsV2'

export type GameSystemArchetypeId =
  | 'rpg_progression'
  | 'card_dbg_combat'
  | 'gacha_equipment_loot'
  | 'avg_mystery_branch'
  | 'roguelike_survivor'
  | 'rule_horror_sanity'
  | 'slg_faction_intrigue'
  | 'universal_full_ui'

export interface GameSystemUiScreenSpec {
  id: string
  titleZh: string
  titleEn: string
  screenKind: 'fullscreen' | 'hud' | 'popup' | 'panel' | 'component'
  aspectRatio: '9:16' | '16:9' | '1:1'
  regionsZh: string[]
  controlsZh: string[]
  wireframeAscii: string
  psdLayersZh: string
  boundMetrics: string[]
}

export interface GameSystemFeatureSpec {
  id: string
  code?: string
  nameZh: string
  nameEn: string
  priority: 'P0' | 'P1' | 'P2'
  triggerZh: string
  rulesZh: string
  ruleSummaryZh?: string
  economyBoundMetrics?: string[]
  edgeCasesZh: string
}

export type GameSystemFeatureModuleSpec = GameSystemFeatureSpec

export interface GameSystemArchetypeProfile {
  id: GameSystemArchetypeId
  labelZh: string
  labelEn: string
  icon: string
  linkedNovelGenres: NovelGenreId[]
  linkedEconomyPresets: (MxTemplateId | string)[]
  coreLoopZh: string
  coreLoopEn: string
  playerGoalZh: string
  designGoalZh: string
  defaultFeatures: GameSystemFeatureSpec[]
  defaultScreens: GameSystemUiScreenSpec[]
}

const ARCHETYPE_RPG: GameSystemArchetypeProfile = {
  id: 'rpg_progression',
  labelZh: '角色养成与境界突破系统',
  labelEn: 'RPG Character & Realm Progression',
  icon: '⚔️',
  linkedNovelGenres: ['xianxia_cultivation', 'urban_reversal'],
  linkedEconomyPresets: ['short_drama_reversal_loop', 'mmorpg_economy'],
  coreLoopZh:
    '主线历练/挂机产出修为与材料 ➔ 冲击境界/身份阶位突破 ➔ 解锁本命底牌/神通槽位 ➔ 挑战幕次守关 Boss',
  coreLoopEn:
    'Stage farming -> Realm/Rank breakthrough -> Unlock signature trump/skill slots -> Defeat Arc Boss',
  playerGoalZh: '循序渐进突破大境界天堑，集齐高阶本命底牌，体验战力跃迁与跨阶逆袭破局的爽感',
  designGoalZh:
    '通过乘区公式与突破成功率控制养成节奏，将小说/数值系统的阶位天花板转化为长线留存目标',
  defaultFeatures: [
    {
      id: 'SYS-RPG-01',
      nameZh: '境界/阶位突破与雷劫试炼',
      nameEn: 'Realm Breakthrough & Trial',
      priority: 'P0',
      triggerZh:
        '玩家角色当前修为/声望经验值达到本阶上限（100%）时，主界面「突破」按钮高亮脉冲激活',
      rulesZh:
        '消耗对应阶位突破信物与核心货币发起突破；突破成功后按经济系统乘区公式提升基础 ATK/HP/DEF 与战力天花板，并解锁新底牌槽位；若渡劫失败则触发保底祝福值累加',
      edgeCasesZh:
        '弱网/断线重连时采用幂等事务锁防止重复扣费；突破材料不足时弹出「奇遇获取途径」引导弹窗；属性连乘结果超过 Number.MAX_SAFE_INTEGER 时自动启用大数科学计数单位（万/亿/兆）'
    },
    {
      id: 'SYS-RPG-02',
      nameZh: '本命底牌与最优连招编成',
      nameEn: 'Trump Card & Optimal Combo Loadout',
      priority: 'P0',
      triggerZh: '角色养成面板点击「底牌/神通槽位」或战前准备界面',
      rulesZh:
        '严格按角色当前境界开放准入槽位（未达标高阶终局底牌显示封存锁标识与解锁章/阶条件）；支持配置「起手铺垫 ➔ 倍率放大 ➔ 终结审判」三段连招序列',
      edgeCasesZh:
        '战斗进行中禁止更换已锁定槽位；连点激活按钮时加 300ms 防抖锁；拖入未解锁高阶底牌时触发抖动反馈与境界不足提示'
    },
    {
      id: 'SYS-RPG-03',
      nameZh: '主线章节冲突与宿敌讨伐',
      nameEn: 'Main Story Arc & Nemesis Showdown',
      priority: 'P1',
      triggerZh: '大地图点击当前主线幕次节点或「宿敌名录」追踪按钮',
      rulesZh:
        '按小说/经济系统幕次曲线生成守关宿敌（展示敌方威胁值与我方战力上限对比）；击败后将宿敌状态更新为「已伏诛/臣服」并掉落本幕奇遇信物',
      edgeCasesZh:
        '战力低于推荐阈值 70% 时弹出「高危卡点预警」二次确认；超时未分胜负按防守方获胜结算并返还门票体力'
    }
  ],
  defaultScreens: [
    {
      id: 'ui_rpg_realm_main',
      titleZh: '角色境界突破与属性总览主界面',
      titleEn: 'Character Realm Breakthrough Screen',
      screenKind: 'fullscreen',
      aspectRatio: '9:16',
      regionsZh: [
        '顶部资源与境界徽章栏（占高 10%，锚定 Top-Stretch）：显示角色名、当前境界阶位、战力上限与三大货币池',
        '中央角色立绘与周天底牌环绕区（占高 52%，锚定 Center）：居中展示角色动态立绘，四周环绕 4 个准入/封存底牌槽位',
        '中下乘区面板与突破进度区（占高 22%，锚定 Bottom-Center）：四维属性对比（突破前 → 突破后）与突破概率/保底进度条',
        '底部主操作栏（占高 16%，锚定 Bottom-Stretch）：材料槽位 + 「冲击突破」主按钮 + 子系统页签切换'
      ],
      controlsZh: [
        '境界突破主按钮（CTA）：默认流光态 / 悬停放大 1.03x / 按下内缩 0.96x / 材料不足禁用灰态 / 突破演算加载态',
        '底牌环绕槽位（4枚）：已装备高亮态 / 空置呼吸加号态 / 后期底牌封存带锁态（点击弹出解锁章节提示）',
        '属性跃迁对比卡：展示 HP / ATK / DEF / 战力天花板突破前后绿色增量箭头'
      ],
      wireframeAscii: [
        '+------------------------------------------+',
        '| [返回]  [境界:潜龙/筑基]   [战力:88,400] |',
        '+------------------------------------------+',
        '|      [槽1:已解锁]      [槽2:已解锁]      |',
        '|                                          |',
        '|            ( 角色中央立绘 )              |',
        '|                                          |',
        '|      [槽3:可镶嵌]      [槽4:🔒封存]      |',
        '+------------------------------------------+',
        '| 突破预览: ATK 112 ➔ 198 (+76%)           |',
        '| 修为进度: [██████████████░░░░] 78%       |',
        '+------------------------------------------+',
        '| [突破信物x1]     (( ⚡ 冲击突破 ))       |',
        '| [角色]   [底牌]   [功法]   [宿敌]  [历练]|',
        '+------------------------------------------+'
      ].join('\n'),
      psdLayersZh:
        '01_Header_Ornaments（顶栏境界徽章与云纹/金线角标） / 02_Interactive_Controls（冲击突破主按钮、4个底牌槽位、底部5页签图标） / 03_Panels_Containers（属性对比九宫格 9-slice 底框、进度条底槽） / 04_Backdrop（全屏意境氛围底图）',
      boundMetrics: [
        'realmStageLabel',
        'powerCeiling',
        'protagonistAtk',
        'protagonistHp',
        'allowedTrumpCards'
      ]
    },
    {
      id: 'ui_rpg_boss_hud',
      titleZh: '主线幕次宿敌对决战斗 HUD',
      titleEn: 'Arc Boss Showdown Battle HUD',
      screenKind: 'hud',
      aspectRatio: '16:9',
      regionsZh: [
        '左上我方状态栏（25% 宽，Top-Left）：头像、境界角标、HP 护盾双层血条、蓄能怒气槽',
        '右上宿敌压迫栏（30% 宽，Top-Right）：Boss 名称、反派威胁阈值、多管血条与狂暴倒计时',
        '中央交锋飘字与连招乘区横幅（Center）：实时展示乘区倍率（基础×增伤×暴击×破防）与暴击数字',
        '右下底牌连招技能轮盘（Bottom-Right）：3 个准入主动底牌 + 1 个终极觉醒大招按钮'
      ],
      controlsZh: [
        '连招底牌按钮：就绪发光态 / 按下释放态 / CD 扇形倒计时遮罩态 / 能量不足禁用态 / 封存不可用态',
        '血条与护盾组件：正常态 / 受击白闪延迟扣血态 / 低血量濒死红框呼吸态'
      ],
      wireframeAscii: [
        '+------------------------------------------------------------+',
        '| [我方:HP █████] [境界]           [宿敌Boss: 威胁 420] [HP] |',
        '| [怒气: ███░░]                    [阶段二 · 护族大阵激活]   |',
        '|                                                            |',
        '|                 <<< 连招倍率 x4.85 暴击! >>>               |',
        '|                                                            |',
        '| [自动] [2x]                        (技1) (技2) ((觉醒底牌))|',
        '+------------------------------------------------------------+'
      ].join('\n'),
      psdLayersZh:
        '01_Header_Ornaments（Boss 威胁警告横幅、连击数字外框） / 02_Interactive_Controls（技能轮盘按钮、自动/倍速开关） / 03_Panels_Containers（血条九宫格底框与遮罩槽）',
      boundMetrics: ['protagonistHp', 'protagonistAtk', 'villainPressure', 'optimalComboSeq']
    },
    {
      id: 'ui_rpg_breakthrough_popup',
      titleZh: '境界突破成功与新底牌解封弹窗',
      titleEn: 'Breakthrough Success & Trump Unlock Modal',
      screenKind: 'popup',
      aspectRatio: '1:1',
      regionsZh: [
        '顶部突破金榜横幅（Top-Center）：展示「境界突破成功」大字标题与阶位晋升徽章',
        '中部新解锁底牌展示台（Center）：高亮展示本阶新解封的准入底牌图标、稀有度与乘区词条',
        '底部属性增幅清单与确认按钮（Bottom-Center）：四维战力增幅明细 + 「收下神通」确认按钮'
      ],
      controlsZh: [
        '确认收下按钮：默认高亮态 / 悬停态 / 按下关闭弹窗态',
        '分享战报次级按钮：默认描边态 / 按下态 / 加载生成截图态'
      ],
      wireframeAscii: [
        '+------------------------------------+',
        '|       ★ 境界突破 · 战力跃迁 ★      |',
        '|       [第1阶] ───► [第2阶]         |',
        '|  +------------------------------+  |',
        '|  |  [新解封底牌图标]            |  |',
        '|  |  词条: 独立乘区倍率 +45%     |  |',
        '|  +------------------------------+  |',
        '|  战力上限: 180 ───► 360 (+100%)    |',
        '|          (( 确认执掌 ))            |',
        '+------------------------------------+'
      ].join('\n'),
      psdLayersZh:
        '01_Header_Ornaments（放射光效、突破勋章丝带） / 02_Interactive_Controls（确认按钮、关闭按钮） / 03_Panels_Containers（居中模态弹窗九宫格底板、半透明暗角遮罩）',
      boundMetrics: ['realmStageLabel', 'powerCeiling', 'allowedTrumpCards']
    }
  ]
}

const ARCHETYPE_CARD_DBG: GameSystemArchetypeProfile = {
  id: 'card_dbg_combat',
  labelZh: '卡牌构筑与回合战斗系统 (DBG)',
  labelEn: 'Deck-Building & Turn-Based Card Combat',
  icon: '🃏',
  linkedNovelGenres: ['xianxia_cultivation', 'lovecraft_rules', 'urban_reversal'],
  linkedEconomyPresets: ['slay_the_spire_dbg', 'hearthstone_ccg', 'balatro_poker_mult'],
  coreLoopZh:
    '回合初能量恢复与不放回抽牌 ➔ 计算费用打出攻击/防御/能力牌触发乘区连携 ➔ 弃牌堆洗回抽牌堆 ➔ 战后三选一构筑抓牌与精简牌库',
  coreLoopEn:
    'Energy refresh & draw -> Play cards within cost for multiplier synergy -> Reshuffle discard -> Post-battle 3-choice draft & deck thin',
  playerGoalZh:
    '通过删牌精简与核心遗物/底牌协同，组建无限流或高爆发卡组，在有限能量内打出指数级单回合峰值伤害',
  designGoalZh:
    '严格遵循经济系统无放回抽牌超几何分布与费用曲线，保证每回合手牌期望输出与怪物意图伤害处于动态博弈平衡',
  defaultFeatures: [
    {
      id: 'SYS-DBG-01',
      nameZh: '无放回牌库循环与能量费用结算内核',
      nameEn: 'Without-Replacement Deck Cycle & Energy Kernel',
      priority: 'P0',
      triggerZh: '战斗开始及每个玩家回合开始阶段（Turn Start Phase）',
      rulesZh:
        '玩家每回合恢复基础能量（默认 3 点）并从抽牌堆顶抽取 5 张手牌；若抽牌堆不足则立即将弃牌堆洗匀补充；打出卡牌扣除对应能量并按「基础点×加算区×独立乘区」结算伤害或护甲',
      edgeCasesZh:
        '手牌达到上限（10 张）时后续抽牌自动飞入弃牌堆并飘字提示「手牌已满」；抽牌堆与弃牌堆均为空时停止抽牌防止死循环；快速连续拖出两张卡时按服务端/本地状态机队列串行校验剩余能量'
    },
    {
      id: 'SYS-DBG-02',
      nameZh: '敌方下回合意图预告与护甲衰减机制',
      nameEn: 'Enemy Intent Telegraph & Block Decay',
      priority: 'P0',
      triggerZh: '敌方单位生成及每回合开始时刷新敌方头顶意图气泡',
      rulesZh:
        '明确公示敌方本回合行动类型（攻击具体数值 / 强化增益 / 塞入诅咒状态牌）；玩家需要在回合结束前叠甲抵消伤害，未消耗护甲在下回合开始时清零（除非持有壁垒遗物）',
      edgeCasesZh:
        '玩家打出眩晕/击破弱点使敌人意图改变时，意图图标需在 200ms 内完成破碎翻转动画并重算伤害预告'
    },
    {
      id: 'SYS-DBG-03',
      nameZh: '战后流派亲和度三选一构筑选牌',
      nameEn: 'Tag-Affinity 3-Choice Card Draft',
      priority: 'P1',
      triggerZh: '战斗胜利结算后弹出战利品构筑面板',
      rulesZh:
        '根据玩家当前牌库已持有的流派标签权重（Tag Affinity）与层数稀有度概率，抽取 3 张候选卡牌供玩家三选一加入牌库，并提供「跳过拿金币」选项防止污染牌库',
      edgeCasesZh:
        '断线重连后必须恢复同一组随机种子生成的 3 张候选卡，严禁通过强退刷卡（Save-Scumming 防护）'
    }
  ],
  defaultScreens: [
    {
      id: 'ui_dbg_battle_hud',
      titleZh: '卡牌构筑回合战斗主界面 HUD',
      titleEn: 'Deck-Building Card Battle HUD',
      screenKind: 'hud',
      aspectRatio: '16:9',
      regionsZh: [
        '顶栏遗物与层数信息条（高 10%，Top-Stretch）：当前层数、金币、已持有核心遗物图标序列与牌库总数按钮',
        '中左主角与中右敌方意图对峙区（高 50%，Center）：主角血条护甲 vs 敌人血条与头顶高对比度「攻击意图数值」气泡',
        '左下能量法力球与抽牌堆角标（Bottom-Left）：显示 `3/3` 当前可用能量与剩余抽牌堆张数',
        '底部扇形手牌弧形交互区（高 36%，Bottom-Center）与右下「结束回合」按钮及弃牌堆角标'
      ],
      controlsZh: [
        '扇形手牌组件：默认弧形排列态 / 悬停抽起放大 1.25x 并置顶态 / 拖拽瞄准贝塞尔箭头态 / 能量不足黑边禁用态 / 打出消散态',
        '能量球（Energy Orb）：满能量沸腾态 / 消耗跳字态 / 0 能量暗淡态',
        '结束回合按钮：默认态 / 无可打出手牌时呼吸高亮提示态 / 敌方行动期间禁用锁态'
      ],
      wireframeAscii: [
        '+------------------------------------------------------------+',
        '| [层数 12/50] [金币:240] [遗物: 🏺 ⚡ 🔥 💍]       [牌库:22]|',
        '+------------------------------------------------------------+',
        '|                                             [意图:⚔️ 28×2] |',
        '|   ( 主角立绘 )                              ( 守关Boss )   |',
        '|  [🛡️18] [HP 64/80]                         [HP 310/450]   |',
        '+------------------------------------------------------------+',
        '| (⚡3/3)    +------+ +------+ +------+ +------+   [结束回合]|',
        '| [抽牌:11]  | 1费  | | 2费  | | 1费  | | 0费  |   [弃牌: 6] |',
        '|            | 斩击 | | 护盾 | | 倍率 | | 过牌 |             |',
        '+------------------------------------------------------------+'
      ].join('\n'),
      psdLayersZh:
        '01_Header_Ornaments（顶栏遗物托盘、敌方意图气泡外框） / 02_Interactive_Controls（卡牌边框模板、能量球、结束回合按钮、抽/弃牌堆图标） / 03_Panels_Containers（血条护甲槽 9-slice 底框）',
      boundMetrics: ['protagonistHp', 'protagonistAtk', 'villainPressure', 'optimalComboSeq']
    },
    {
      id: 'ui_dbg_draft_popup',
      titleZh: '战后流派三选一抓牌构筑弹窗',
      titleEn: 'Post-Battle 3-Choice Card Draft Modal',
      screenKind: 'popup',
      aspectRatio: '16:9',
      regionsZh: [
        '顶部标题与当前牌库流派亲和度提示条（Top-Center）',
        '中央三张候选卡牌并列展示区（Center）：展示费用、卡图、流派标签、稀有度边框与升级预览勾选框',
        '底部「跳过（+25金币）」与「查看当前牌库」辅助按钮（Bottom-Center）'
      ],
      controlsZh: [
        '候选卡牌槽（3个）：默认态 / 悬停发光上浮态 / 选中确认态',
        '预览升级（Upgrade Preview）复选框：未勾选态 / 勾选后三张卡实时切换显示 `+` 强化数值态'
      ],
      wireframeAscii: [
        '+------------------------------------------------------------+',
        '|               ★ 选择一张卡牌加入你的牌库 ★                 |',
        '|  +----------------+  +----------------+  +--------------+  |',
        '|  | [1费 · 稀有]   |  | [2费 · 史诗]   |  | [0费 · 普通] |  |',
        '|  |  太虚剑意      |  |  百倍反震盾    |  |  灵光一闪    |  |',
        '|  | 造成14点伤害， |  | 获得18点护甲， |  | 抽2张牌，本  |  |',
        '|  | 易伤乘区+50%   |  | 反弹等量伤害   |  | 回合能量+1   |  |',
        '|  +----------------+  +----------------+  +--------------+  |',
        '|       [✓ 预览升级效果]        (( 跳过选牌 (+25金币) ))     |',
        '+------------------------------------------------------------+'
      ].join('\n'),
      psdLayersZh:
        '01_Header_Ornaments（稀有度金/紫/蓝卡框头饰） / 02_Interactive_Controls（三张独立卡牌容器、跳过按钮、复选框） / 03_Panels_Containers（半透明暗色背景板与 9-slice 弹窗外框）',
      boundMetrics: ['allowedTrumpCards', 'recommendedEncounterItem']
    }
  ]
}

const ARCHETYPE_GACHA_LOOT: GameSystemArchetypeProfile = {
  id: 'gacha_equipment_loot',
  labelZh: '商业化抽卡与装备词条系统 (Gacha & Loot)',
  labelEn: 'Gacha Pity & Equipment Sub-stat System',
  icon: '💎',
  linkedNovelGenres: ['urban_reversal', 'xianxia_cultivation', 'romance_palace'],
  linkedEconomyPresets: ['hearthstone_ccg', 'onmyoji_atb_souls', 'mmorpg_economy'],
  coreLoopZh:
    '日常活跃/付费获取抽卡券与体力 ➔ 限定UP卡池保底寻访核心角色/信物 ➔ 刷取6号位主属性与双暴副属性词条装备 ➔ 词条强化毕业挑战高难排行',
  coreLoopEn:
    'Earn tickets/stamina -> Pull on Soft/Hard Pity Banner -> Farm main/substat gear -> Enhance rolls for endgame',
  playerGoalZh: '在明确的保底预期内抽到心仪核心人脉/角色，刷出极品四词条装备实现暴击与暴伤乘区毕业',
  designGoalZh:
    '利用软保底（Soft Pity）递增曲线与大保底（50/50 歪后必出 UP）消除极端非酋流失，用副属性随机强化作为长线体力消耗黑洞',
  defaultFeatures: [
    {
      id: 'SYS-GACHA-01',
      nameZh: '限定 UP 卡池软/硬双保底寻访机制',
      nameEn: 'Soft/Hard Pity Rate-Up Gacha Banner',
      priority: 'P0',
      triggerZh: '寻访界面点击「单抽」或「十连寻访」按钮',
      rulesZh:
        '严格按经济系统保底参数执行：1~60 抽为基础概率（如 1.2%），第 61 抽起触发软保底每抽递增，第 80 抽 100% 必出五星/SSR；若本次 SSR 非当期 UP 角色，则下一次获得的 SSR 100% 锁定为当期 UP（大小保底跨期继承）',
      edgeCasesZh:
        '抽卡券不足时自动计算差额弹出晶石兑换确认框；十连动画播放中途断线或闪退时，服务端已完成落库，重连后在「寻访记录」与背包中完整可见；概率公示弹窗必须精确到小数点后两位'
    },
    {
      id: 'SYS-GACHA-02',
      nameZh: '装备/御魂主副属性生成与强化跳点系统',
      nameEn: 'Equipment Main/Sub-stat Roll & Enhancement',
      priority: 'P0',
      triggerZh: '装备掉落结算及装备工坊点击「强化 +3/+6/+9/+12/+15」',
      rulesZh:
        '1/3/5 号位固定主属性，2/4/6 号位按权重随机产出速度/攻击加成/暴击/暴击伤害主属性；初始附带 2~4 条不重复副属性，每强化 +3 级随机在一条副属性上追加一次跳点（严禁词条重复）',
      edgeCasesZh:
        '穿戴中或已上锁的极品装备严禁作为强化狗粮吞噬；一键强化至 +15 若中途金币不足，自动停在最高可达等级并结算实际消耗'
    }
  ],
  defaultScreens: [
    {
      id: 'ui_gacha_banner_main',
      titleZh: '限定 UP 角色/底牌寻访卡池主界面',
      titleEn: 'Limited Rate-Up Gacha Banner Screen',
      screenKind: 'fullscreen',
      aspectRatio: '16:9',
      regionsZh: [
        '顶栏货币与保底计数器区（Top-Stretch）：显示抽卡券、钻石数量及醒目的「距离必出 SSR 还剩 X 抽」保底进度条',
        '左侧卡池切换页签栏（Left-Column，占宽 18%）：限定角色池 / 专武底牌池 / 常驻池切换',
        '主视觉立绘与 UP 角色技能预览区（Center，占宽 64%）：当期 UP 主角/核心盟友大图、属性定位与试用入口',
        '右下十连/单抽操作区与左下详情/记录辅助按钮区（Bottom）'
      ],
      controlsZh: [
        '十连寻访主按钮：鎏金高亮态 / 悬停流光态 / 按下态 / 资源不足红字提示态',
        '保底进度条组件：常规态 / 进入软保底区间（60抽+）金色脉冲态',
        '概率公示与寻访记录按钮：默认半透明毛玻璃态 / 点击弹出历史明细表态'
      ],
      wireframeAscii: [
        '+------------------------------------------------------------+',
        '| [返回]  [限定卡池: 潜龙天命]     [寻访券:18] [钻:3,280] [+] |',
        '+------------------------------------------------------------+',
        '| [限定角色池] |                                             |',
        '| [专属底牌池] |        ★ 当期 UP: 核心主C / 传奇底牌 ★      |',
        '| [常驻寻访池] |           [角色试用]    [满级属性预览]      |',
        '|              |                                             |',
        '| [概率公示]   |   保底计数: 距离必出五星还剩 [ 14 / 80 ] 抽 |',
        '| [寻访记录]   |        [寻访 1 次]     (( 寻访 10 次 ))     |',
        '+------------------------------------------------------------+'
      ].join('\n'),
      psdLayersZh:
        '01_Header_Ornaments（UP 稀有度星级徽章、保底计数金框） / 02_Interactive_Controls（单抽/十连主按钮、左侧卡池页签、试用小按钮） / 03_Panels_Containers（立绘信息半透明铭牌 9-slice 底框） / 04_Backdrop（卡池主题全屏海报层）',
      boundMetrics: ['allowedTrumpCards', 'recommendedEncounterItem']
    },
    {
      id: 'ui_gacha_substat_panel',
      titleZh: '装备/信物副属性词条强化面板',
      titleEn: 'Equipment Sub-stat Enhancement Panel',
      screenKind: 'panel',
      aspectRatio: '16:9',
      regionsZh: [
        '左侧六号位装备轮盘与套装激活效果区（占宽 42%）',
        '右侧当前选中装备主属性 + 4 条副属性跳点明细与强化预览区（占宽 58%）'
      ],
      controlsZh: [
        '装备槽位（1~6号位）：已穿戴态 / 空置态 / 极品双暴高亮金边态',
        '强化按钮与锁定小图标：锁定态防止误分解 / 一键 +15 快捷开关'
      ],
      wireframeAscii: [
        '+------------------------------------------------------------+',
        '|   [1号位]        [6号位]   |  【天命玄戒 · +12】  [🔒已锁] |',
        '|      \\            /        |  主属性: 暴击伤害 +55% ➔ +89% |',
        '|   [2号位] (套装) [5号位]   |  • 暴击率   +11.2% (跳点×3)   |',
        '|      /            \\        |  • 攻击加成 +8.4%  (跳点×1)   |',
        '|   [3号位]        [4号位]   |  • 速度     +6     (初始)     |',
        '|  套装: 4件套独立增伤 +30%  |  [放入材料]  (( 强化至 +15 )) |',
        '+------------------------------------------------------------+'
      ].join('\n'),
      psdLayersZh:
        '01_Header_Ornaments（强化等级角标、跳点星标） / 02_Interactive_Controls（6个六边形装备槽、锁定按钮、强化主按钮） / 03_Panels_Containers（右侧词条详情 9-slice 面板框）',
      boundMetrics: ['protagonistAtk', 'powerCeiling']
    }
  ]
}

const ARCHETYPE_AVG_MYSTERY: GameSystemArchetypeProfile = {
  id: 'avg_mystery_branch',
  labelZh: '互动影游分支叙事与搜证推理系统 (AVG)',
  labelEn: 'Interactive Narrative Branching & Detective Investigation',
  icon: '🔍',
  linkedNovelGenres: ['mystery_detective', 'romance_palace', 'urban_reversal'],
  linkedEconomyPresets: ['short_drama_reversal_loop'],
  coreLoopZh:
    '沉浸剧情演出与关键好感/理智抉择 ➔ 案发/核心现场多热点搜证 ➔ 思维导图线索拼接合成铁证 ➔ 对质指认击破反派谎言解锁真结局',
  coreLoopEn:
    'Narrative scene & choice -> Point-and-click clue search -> Clue synthesis mind-map -> Confrontation & rebuttal for True Ending',
  playerGoalZh:
    '收集全部隐藏线索，在多分支命运节点做出高智商抉择，当众拆穿真凶/反派诡计，达成 100% 真相还原度',
  designGoalZh:
    '将小说中的伏笔池（Foreshadowing Pool）与准入铁证转化为可交互的搜证与出示证物玩法，杜绝无脑点点点',
  defaultFeatures: [
    {
      id: 'SYS-AVG-01',
      nameZh: '命运分支抉择与真相还原度/好感度结算',
      nameEn: 'Fate Branching Choice & Truth/Affinity Meter',
      priority: 'P0',
      triggerZh: '章节剧情播放至戏剧节拍高潮卡点时弹出限时或不限时分支选项',
      rulesZh:
        '每个选项绑定对应的数值变化（如真相还原度 +15 / 反派警惕度 +10）与持有信物前置条件（持有特定准入底牌/证据才可解锁隐藏破局选项）；选择结果实时写入章节故事树',
      edgeCasesZh:
        '限时选项倒计时归零未操作时自动选择默认隐忍选项；玩家从故事树回溯重打某节点时，采用快照分支存档而不覆盖已解锁图鉴'
    },
    {
      id: 'SYS-AVG-02',
      nameZh: '现场多焦点勘查与铁证合成推演台',
      nameEn: 'Scene Investigation & Evidence Synthesis Board',
      priority: 'P0',
      triggerZh: '进入搜证阶段或点击 HUD 右上角「线索簿/推理台」',
      rulesZh:
        '支持在现场背景图上点击可疑热点收集初级线索；在推理台中将两条存在逻辑关联的线索拖拽连线，合成具备决定性证明力的「本章准入关键铁证」',
      edgeCasesZh:
        '未集齐必拿核心线索前点击「结束勘查」弹出搭档委婉提示；错误连线拼接时扣除少量理智/信任值并给出逻辑矛盾提示'
    }
  ],
  defaultScreens: [
    {
      id: 'ui_avg_dialogue_hud',
      titleZh: '互动影游对话演出与命运分支抉择 HUD',
      titleEn: 'Interactive Dialogue & Fate Choice HUD',
      screenKind: 'hud',
      aspectRatio: '16:9',
      regionsZh: [
        '左上真相还原度/气场值动态仪表与右上「故事线/线索簿/自动/快进」功能条（Top）',
        '中央角色半身动态立绘/视频画幅与限时命运分支选项悬浮区（Center）',
        '底部电影感字幕对话框（高 26%，Bottom-Stretch）：说话人铭牌、逐字打字机台词与出示证物快捷入口'
      ],
      controlsZh: [
        '分支选项长条按钮（2~3个）：常规选项态 / 需持有关键证据才可点击的「🔑铁证破局」金色专属态 / 悬停态 / 选中确认态',
        '底部功能胶囊按钮：自动播放高亮态 / 快进态 / 历史回顾弹窗态 / 线索簿红点提示态'
      ],
      wireframeAscii: [
        '+------------------------------------------------------------+',
        '| [真相还原度: 72%] [迷雾度: 45%]     [线索簿(3)] [故事线]   |',
        '|                                                            |',
        '|      +----------------------------------------------+      |',
        '|      | > [普通选项] 暂时隐忍，记下对方话里的漏洞    |      |',
        '|      | > [🔑出示铁证: 7分钟监控空白] 当场戳穿不在场!|      |',
        '|      +----------------------------------------------+      |',
        '|                    [ 倒计时: 08.4s ]                       |',
        '+------------------------------------------------------------+',
        '| 【沈默】                                        [出示证物] |',
        '| “你说案发时你在三楼书房，那这张超市小票怎么解释？”         |',
        '+------------------------------------------------------------+'
      ].join('\n'),
      psdLayersZh:
        '01_Header_Ornaments（说话人铭牌装饰角、限时进度条发光头） / 02_Interactive_Controls（分支选项条、出示证物按钮、右上工具栏图标） / 03_Panels_Containers（底部对话框 9-slice 毛玻璃底框）',
      boundMetrics: ['powerCeiling', 'villainPressure', 'allowedTrumpCards']
    },
    {
      id: 'ui_avg_mindmap_board',
      titleZh: '线索拼接与诡计拆解推理面板',
      titleEn: 'Clue Synthesis & Deduction Mind-Map Panel',
      screenKind: 'fullscreen',
      aspectRatio: '16:9',
      regionsZh: [
        '左侧已收集现场线索卡片抽屉（占宽 28%）',
        '中央思维导图连线推演画布（占宽 72%）：支持拖入两个线索槽位合成为核心铁证',
        '底部「开始当众指认」主操作栏'
      ],
      controlsZh: [
        '线索卡片组件：未拼接态 / 拖拽连线态 / 已合成铁证金印态',
        '指认真凶主按钮：真相还原度未达标禁用态 / 铁证齐备高亮可点击态'
      ],
      wireframeAscii: [
        '+------------------------------------------------------------+',
        '| [返回现场]        ★ 思维推演与证据链闭合 ★      [还原:85%] |',
        '+------------------------------------------------------------+',
        '| [已获线索]     |                                           |',
        '| • 半枚鞋印     |    [监控7分钟空白] ──+                    |',
        '| • 定时短信     |                      ├──► 【🔑核心铁证】  |',
        '| • 撕角旧照     |    [死者定时短信]  ──+    延时不在场诡计! |',
        '|                |                                           |',
        '|                |               (( ⚡ 召集众人 · 指认真凶 )) |',
        '+------------------------------------------------------------+'
      ].join('\n'),
      psdLayersZh:
        '01_Header_Ornaments（机密档案印章、红线图钉元素） / 02_Interactive_Controls（线索卡片外框、合成槽位、指认主按钮） / 03_Panels_Containers（左侧抽屉与软木板/全息底板 9-slice 容器）',
      boundMetrics: ['allowedTrumpCards', 'recommendedEncounterItem', 'powerCeiling']
    }
  ]
}

const ARCHETYPE_SURVIVOR: GameSystemArchetypeProfile = {
  id: 'roguelike_survivor',
  labelZh: '肉鸽局内构筑与波次生存系统 (Survivor)',
  labelEn: 'Roguelike In-Run Build & Wave Survival',
  icon: '🔥',
  linkedNovelGenres: ['scifi_apocalypse', 'xianxia_cultivation'],
  linkedEconomyPresets: ['slay_the_spire_dbg', 'balatro_poker_mult'],
  coreLoopZh:
    '走位清剿异种/怪潮拾取经验晶核 ➔ 局内升级触发流派三选一武装进化 ➔ 凑齐主被动羁绊合成超武 ➔ 顶住第 N 波高压尸潮与守关母巢 Boss',
  coreLoopEn:
    'Kite waves & collect XP gems -> Level-up 3-choice weapon/passive draft -> Evolve super weapons -> Survive Boss wave wall',
  playerGoalZh: '在不断飙升的怪潮密度下完成超武进化闭环，享受满屏弹幕清场的割草快感',
  designGoalZh:
    '严控经济系统 Layer 4 怪潮膨胀墙（Enemy Scaling Wall）与玩家单局经验获取速率，在 3/6/10 分钟设置精英与 Boss 压力检测点',
  defaultFeatures: [
    {
      id: 'SYS-SURV-01',
      nameZh: '波次怪潮生成器与同屏经验晶核磁吸结算',
      nameEn: 'Wave Spawner & XP Gem Magnet Kernel',
      priority: 'P0',
      triggerZh: '单局生存计时器每秒 Tick 驱动',
      rulesZh:
        '按波次时间轴动态调整同屏敌人数量上限与精英怪刷出权重；击杀掉落经验晶核，进入主角拾取半径后平滑加速吸附并填充顶部经验条',
      edgeCasesZh:
        '同屏掉落物超过 300 个时自动合并远处经验晶核为高阶晶核，严防移动端掉帧；角色升级弹窗打开时局内物理与计时器完全暂停'
    },
    {
      id: 'SYS-SURV-02',
      nameZh: '主武器 + 被动信物满级超武进化合成',
      nameEn: 'Super Weapon Evolution Synergy',
      priority: 'P0',
      triggerZh: '主武器升至满级（Lv.8）且持有对应配对被动信物时，拾取精英宝箱触发',
      rulesZh:
        '将满级主武器突破进化为超武（独立乘区倍率质变、弹道形态重构），同时解放一个武器栏位上限',
      edgeCasesZh: '若场上所有武器与被动均已满级，升级与宝箱自动替换为回复生命值或金币袋选项'
    }
  ],
  defaultScreens: [
    {
      id: 'ui_surv_battle_hud',
      titleZh: '波次生存割草战斗主界面 HUD',
      titleEn: 'Wave Survival Battle HUD',
      screenKind: 'hud',
      aspectRatio: '9:16',
      regionsZh: [
        '顶部全宽经验条与生存倒计时/击杀数/金币统计栏（Top-Stretch）',
        '左上 6 格主武器栏 + 6 格被动信物栏微缩图标槽（Top-Left）',
        '中央俯视角战场与主角脚下血条弧线（Center）',
        '底部居中虚拟摇杆触控区（Bottom-Center）'
      ],
      controlsZh: [
        '虚拟摇杆组件：默认半透明隐匿态 / 触控拖拽指向态 / 释放回中态',
        'Boss 来袭红色警戒横幅：波次卡点触发时闪烁滑入态'
      ],
      wireframeAscii: [
        '+------------------------------------------+',
        '| [EXP ████████████████░░░░░] Lv.14        |',
        '| [⚔️][⚡][🔥][  ]  ⏱️ 08:45   💀 2,410    |',
        '| [💍][🥾][🔋][  ]             🪙 680      |',
        '+------------------------------------------+',
        '|      ⚠️ 警告: 母巢领主波次即将降临!      |',
        '|                                          |',
        '|               ( 主角 )                   |',
        '|              [HP ████░]                  |',
        '|                                          |',
        '|                 ( 🕹️ )                   |',
        '+------------------------------------------+'
      ].join('\n'),
      psdLayersZh:
        '01_Header_Ornaments（Boss 警戒条、等级徽章） / 02_Interactive_Controls（虚拟摇杆底盘与摇杆头、暂停按钮、12格武器被动小槽位） / 03_Panels_Containers（顶部经验条 9-slice 槽框）',
      boundMetrics: ['protagonistHp', 'protagonistAtk', 'villainPressure', 'powerCeiling']
    }
  ]
}

const ARCHETYPE_RULE_HORROR: GameSystemArchetypeProfile = {
  id: 'rule_horror_sanity',
  labelZh: '规则怪谈理智值 (SAN) 与异常收容系统',
  labelEn: 'Rule Horror Sanity (SAN) & Anomaly Containment',
  icon: '👁️',
  linkedNovelGenres: ['lovecraft_rules', 'mystery_detective'],
  linkedEconomyPresets: ['slay_the_spire_dbg', 'short_drama_reversal_loop'],
  coreLoopZh:
    '进入怪谈副本收集残缺守则 ➔ 辨识真假规则与环境异常 ➔ 消耗理智值(SAN)动用禁忌遗物卡规则漏洞 ➔ 封印收容核心诡异并结算理智代价',
  coreLoopEn:
    'Enter rule dungeon & read rules -> Spot fake rules & anomalies -> Spend SAN to use relics & exploit loopholes -> Seal anomaly',
  playerGoalZh: '在理智值归零前识破被污染篡改的伪规则，利用规则之间的逻辑悖论反制不可名状之物',
  designGoalZh:
    '以「理智值 (SAN) vs 诡异污染度」双轴取代传统血条对砍，UI 随 SAN 值降低产生视觉扭曲反馈',
  defaultFeatures: [
    {
      id: 'SYS-SAN-01',
      nameZh: '理智值（SAN）阈值分级与 UI 认知污染反馈',
      nameEn: 'Sanity Tier Thresholds & UI Perceptual Distortion',
      priority: 'P0',
      triggerZh: '玩家目睹异常现象、违反次级守则或主动发动禁忌遗物时实时结算',
      rulesZh:
        'SAN 值分为 100~70（清醒）、69~30（幻听与守则文字局部渗血闪烁）、29~1（重度污染：出现伪造的第五个诱惑选项）、0（理智崩坏触发坏结局）；可使用镇静剂或安全屋怀表恢复',
      edgeCasesZh:
        '开启「无障碍防眩晕模式」时，禁用高频闪屏与剧烈抖动，改用静态紫黑色暗角边框表达污染度'
    },
    {
      id: 'SYS-SAN-02',
      nameZh: '守则真伪批注与规则悖论处决机制',
      nameEn: 'Rule Annotation & Paradox Execution',
      priority: 'P0',
      triggerZh: '打开「员工守则/住户须知」夹板并长按某条规则条目',
      rulesZh:
        '玩家可将守则条目批注为「✅真规则」「❌被篡改伪规则」；当两条规则存在冲突时，拖入对应禁忌遗物触发「悖论破局」，直接削减副本诡异核心污染度',
      edgeCasesZh:
        '误判真规则并执行违抗操作时，先触发一次「规则警告（扣除 35% SAN）」而非直接即死，保留容错空间'
    }
  ],
  defaultScreens: [
    {
      id: 'ui_san_rules_clipboard',
      titleZh: '怪谈守则批注夹板与理智监测 HUD',
      titleEn: 'Rule Horror Clipboard & Sanity Monitor HUD',
      screenKind: 'fullscreen',
      aspectRatio: '16:9',
      regionsZh: [
        '顶栏理智值（SAN）心电图监测仪与当前诡异污染度进度条（Top-Stretch）',
        '左侧第一人称异常场景观察窗（占宽 52%）',
        '右侧泛黄守则档案夹板（占宽 48%）：列出第 1~6 条规则，支持划线批注真伪与拖入遗物'
      ],
      controlsZh: [
        '守则条目批注开关：未标记态 / 绿勾确认真规则态 / 红叉划除伪规则态 / 污染滲血态',
        '禁忌遗物快捷栏：冷却态 / 激活消耗 SAN 预览态'
      ],
      wireframeAscii: [
        '+------------------------------------------------------------+',
        '| [🧠 理智 SAN: 58/100 〰️]   [👁️ 诡异污染度: 74%]   [怀表] |',
        '+------------------------------------------------------------+',
        '|                           |  📋【404公寓住户守则】         |',
        '|                           |  [✅] 1. 午夜12点后请勿照镜子  |',
        '|     ( 走廊异常监控画面 )  |  [❌] 2. 红衣管理员绝对可信    |',
        '|     [发现异常: 13层按钮]  |  [❓] 3. 听到三次敲门必须开门  |',
        '|                           |  +--------------------------+  |',
        '|  [遗物: 不映背后的镜子]   |  | ⚡ 注入遗物 · 触发悖论破局|  |',
        '+------------------------------------------------------------+'
      ].join('\n'),
      psdLayersZh:
        '01_Header_Ornaments（SAN心电图外框、血迹/抓痕装饰贴图） / 02_Interactive_Controls（真伪批注印章按钮、遗物槽位、触发悖论主按钮） / 03_Panels_Containers（右侧档案夹板 9-slice 纸张底板）',
      boundMetrics: ['powerCeiling', 'villainPressure', 'allowedTrumpCards']
    }
  ]
}

const ARCHETYPE_SLG_INTRIGUE: GameSystemArchetypeProfile = {
  id: 'slg_faction_intrigue',
  labelZh: 'SLG 势力经营与朝堂权谋外交系统',
  labelEn: 'SLG Faction Management & Court Intrigue',
  icon: '👑',
  linkedNovelGenres: ['historical_intrigue', 'urban_reversal'],
  linkedEconomyPresets: ['mmorpg_economy', 'short_drama_reversal_loop'],
  coreLoopZh:
    '经营封地/产业积累钱粮与情报筹码 ➔ 门客招揽与新政颁布提升国力/权势 ➔ 朝堂/商战联名弹劾与合纵连横 ➔ 金殿对质扳倒门阀晋升官阶',
  coreLoopEn:
    'Manage territory & intelligence -> Recruit retainers & enact decrees -> Factional coalition & impeachment -> Court showdown & rank promotion',
  playerGoalZh: '从寒门微末步步经营人脉与兵权筹码，在多方势力制衡中瓦解世家门阀，登顶摄政首辅',
  designGoalZh:
    '将经济系统的资源产销比（Source/Drain）转化为钱粮、民心、朝堂威望三维动态平衡，用证据筹码取代纯武力碾压',
  defaultFeatures: [
    {
      id: 'SYS-SLG-01',
      nameZh: '三维政务资源（钱粮/民心/权势）产销平衡与新政令',
      nameEn: 'Tri-Resource Economy & Policy Decree System',
      priority: 'P0',
      triggerZh: '每季度/每回合政务结算阶段及政务厅点击「颁布新政」',
      rulesZh:
        '每项新政令同时具备正负双向乘区影响（如「清丈田亩」：岁入银两 +35%，但世家门阀敌意压力 +20）；任一核心指标跌破警戒线将触发流民哗变或满朝弹劾事件',
      edgeCasesZh: '国库银两扣减至负数时自动冻结在建工程并触发「户部告急」借贷弹窗，防止死档'
    },
    {
      id: 'SYS-SLG-02',
      nameZh: '金殿朝议交锋与把柄铁证弹劾对决',
      nameEn: 'Imperial Court Debate & Leverage Impeachment',
      priority: 'P0',
      triggerZh: '大朝会节点或政敌发起联名弹劾时触发',
      rulesZh:
        '双方按官阶品级与门客辩才展开多轮奏对；玩家可打出暗中收集的「准入权谋筹码（如私盐旧账、密谋书信）」一锤定音逆转圣心倾向度',
      edgeCasesZh:
        '未持有致命把柄强行弹劾高品级权臣时，会触发「反噬构陷」扣除自身威望并进入软禁防守回合'
    }
  ],
  defaultScreens: [
    {
      id: 'ui_slg_court_main',
      titleZh: '朝堂势力沙盘与金殿对质主界面',
      titleEn: 'Court Faction Sandbox & Debate Screen',
      screenKind: 'fullscreen',
      aspectRatio: '16:9',
      regionsZh: [
        '顶栏官阶品级与「岁入银两 / 民心安定 / 朝堂权势 / 门阀压力」四维指标栏（Top-Stretch）',
        '中央朝堂派系站队图谱与圣心天平指示器（Center）',
        '底部权谋筹码手牌区与「呈递密奏 / 联名弹劾 / 推行新政」操作栏（Bottom）'
      ],
      controlsZh: [
        '圣心天平指针组件：中立态 / 偏向我方金光态 / 政敌压境红警态',
        '权谋筹码卷轴按钮：已掌握可用态 / 尚在密探收集中进度态 / 终局密诏封存态'
      ],
      wireframeAscii: [
        '+------------------------------------------------------------+',
        '| [官阶:四品侍郎]  [银两:48万] [民心:86] [权势:340 vs 门阀:310]|',
        '+------------------------------------------------------------+',
        '|   [寒门新政派]          ⚖️ 圣心倾向          [世家门阀党]   |',
        '|   • 顾清和(主)      [██████████░░░░░░]       • 王丞相(敌)  |',
        '|   • 周老御史                                 • 户部侍郎    |',
        '+------------------------------------------------------------+',
        '| 可用权谋筹码: [📜盐铁私账] [📜边军效忠书] [🔒先帝密诏]     |',
        '|               [推行新政]   [暗中拉拢]   (( ⚡ 金殿弹劾 ))  |',
        '+------------------------------------------------------------+'
      ].join('\n'),
      psdLayersZh:
        '01_Header_Ornaments（官服补子徽章、圣心天平雕花支架） / 02_Interactive_Controls（竹简/卷轴筹码按钮、金殿弹劾玉玺主按钮） / 03_Panels_Containers（派系名录 9-slice 朱漆木框）',
      boundMetrics: ['realmStageLabel', 'powerCeiling', 'villainPressure', 'allowedTrumpCards']
    }
  ]
}

const ARCHETYPE_UNIVERSAL: GameSystemArchetypeProfile = {
  id: 'universal_full_ui',
  labelZh: '通用交互系统 / 虚拟仿真与全套 UI',
  labelEn: 'Universal Interactive / Simulation & Full UI Suite',
  icon: '🏛️',
  linkedNovelGenres: ['custom_literary', 'urban_reversal', 'xianxia_cultivation'],
  linkedEconomyPresets: ['short_drama_reversal_loop', 'slay_the_spire_dbg', 'mmorpg_economy'],
  coreLoopZh:
    '主场景导览与状态总览 ➔ 核心主题/三维模型深度交互 ➔ 智能问答/任务测评与实时反馈 ➔ 记录归档与阶段目标达成',
  coreLoopEn:
    'Main hub navigation -> Core model/module interaction -> Q&A / assessment feedback -> Record archiving & milestone completion',
  playerGoalZh: '零学习成本完成核心场景切换、对象多维检视、即时反馈校验与结果复盘的完整交互闭环',
  designGoalZh:
    '输出不强行绑定战斗/抽卡数值的通用工程级系统策划案（兼容虚拟教学、数字孪生、模拟交互与综合应用大厅）及可一键拆分的 UI 界面矩阵',
  defaultFeatures: [
    {
      id: 'SYS-HUB-01',
      code: 'SYS-HUB-01',
      nameZh: '主场景分区导航与全局状态总览',
      nameEn: 'Main Hub Navigation & Global Status HUD',
      priority: 'P0',
      triggerZh: '系统启动默认进入主场景，或通过顶部/底部导航栏一键切换主题分区',
      rulesZh:
        '维护当前激活场景 ID、用户角色权限、设备/网络状态与进度快照；切换分区前自动保存相机视角与上下文状态，异步预加载目标资源并通过平滑转场完成切换。',
      edgeCasesZh:
        '同控件 300ms 防抖合并重复点击；目标分区资源加载超时（>8s）提供取消与重试入口并回退原场景；断网状态保留本地已缓存模块可用。'
    },
    {
      id: 'SYS-INTERACT-02',
      code: 'SYS-INTERACT-02',
      nameZh: '核心对象多维检视、分层交互与知识联动',
      nameEn: 'Multi-View Object Inspection & Knowledge Linkage',
      priority: 'P0',
      triggerZh: '在主题工作台选中三维模型、图谱条目或交互热点',
      rulesZh:
        '支持旋转、缩放、剖切/分层显隐与标准锚点高亮；选中热点实时联动右侧结构化详情卡、操作步骤演示与语音/文本同步讲解。',
      edgeCasesZh:
        '缩放与视角设置安全上下限防止穿模；输入失焦或追踪丢失时立即终止拖拽并保持上一有效姿态；缺失某层扩展资产时禁用对应开关并明示原因。'
    },
    {
      id: 'SYS-EVAL-03',
      code: 'SYS-EVAL-03',
      nameZh: '实训测评计分、幂等提交与记录报告归档',
      nameEn: 'Assessment Scoring, Idempotent Submit & Report Archive',
      priority: 'P1',
      triggerZh: '完成主题学习后点击「开始测评」或进入记录中心查看历史报告',
      rulesZh:
        '服务端生成固定版本测评快照，每次作答实时草稿落盘；按计分公式结算总分、耗时与薄弱项分布，生成可导出与错题重做的闭环报告。',
      edgeCasesZh:
        '提交携带唯一幂等键防止连点产生重复成绩；断网时本地加密暂存草稿并在重连后按时间戳去重同步；未达权限不提前暴露标准答案。'
    }
  ],
  defaultScreens: [
    {
      id: 'ui_univ_main_hud',
      titleZh: '沉浸式主场景导航与状态总览 HUD',
      titleEn: 'Main Scene Navigation & Status HUD',
      screenKind: 'hud',
      aspectRatio: '16:9',
      regionsZh: [
        '顶部全局状态栏（占高 8%，Top-Stretch）：展示当前场景/主题名称、设备连接状态与个人权限入口',
        '中央主视口交互区（占高 84%，Center）：承载核心三维场景/主视觉画布与热点标记悬浮气泡',
        '底部模块导航坞（占高 8%，Bottom-Stretch）：核心业务模块一键切换按钮组与快捷辅助工具'
      ],
      controlsZh: [
        '底部模块导航按钮组：默认常驻态 / 悬停高亮提示态 / 按下切换态 / 受限模式禁用态',
        '场景对象热点标记：默认呼吸锚点态 / 悬停展开摘要态 / 选中锁定详情态 / 超出同屏上限聚合态'
      ],
      wireframeAscii: [
        '+------------------------------------------------------------+',
        '| [当前场景/主题]                      [设备状态] [账号/设置] |',
        '+------------------------------------------------------------+',
        '|                                                            |',
        '|               ( 中央主场景 / 核心交互视口 )                |',
        '|                                         [快捷问答/助手浮窗] |',
        '| [操作引导提示条]                                           |',
        '+------------------------------------------------------------+',
        '|   [场景切换]   [核心交互]   [知识检索]   [实训测评] [记录] |',
        '+------------------------------------------------------------+'
      ].join('\n'),
      psdLayersZh:
        '01_Header_Ornaments（顶栏状态横幅与角标装饰） / 02_Interactive_Controls（底部导航坞七态按钮、热点标记图标、麦克风/设置按钮） / 03_Panels_Containers（顶部与底部 HUD 9-slice 九宫格底框、快捷浮窗九宫格面板） / 04_Backdrop（独立主场景渲染视口层）',
      boundMetrics: ['activeSceneId', 'frameLatencyMs', 'completionRatePct']
    },
    {
      id: 'ui_univ_workspace',
      titleZh: '核心对象多维检视与步骤演示工作台',
      titleEn: 'Interactive Inspection & Step Demo Workspace',
      screenKind: 'fullscreen',
      aspectRatio: '16:9',
      regionsZh: [
        '左侧分类检索与目录树栏（占宽 22%，Left-Stretch）：关键词搜索框、多级分类筛选与对象列表',
        '中央多维模型/图谱检视视口（占宽 54%，Center）：支持旋转、分层显隐、局部放大与步骤播放控制',
        '右侧结构化详情与规范说明栏（占宽 24%，Right-Stretch）：属性参数表、标准依据引用与演示控制条'
      ],
      controlsZh: [
        '目录检索输入框与列表项：默认态 / 悬停态 / 选中锁定态 / 空搜索结果引导态',
        '分层开关与步骤播放器（播放/暂停/单步/复位）：默认态 / 激活态 / 未审核资源禁用态 / 加载进度态'
      ],
      wireframeAscii: [
        '+------------------------------------------------------------+',
        '| [←返回]  [当前交互主题标题]                  [引用/版本状态]|',
        '+-------------+--------------------------------+-------------+',
        '| [搜索框...] |                                | [对象标准名] |',
        '| - 分类目录A |      ( 三维模型 / 高清图谱 )   | - 核心参数   |',
        '| - 分类目录B |        [剖切/局部放大手柄]     | - 步骤说明   |',
        '| - 分类目录C |                                | - 来源依据   |',
        '+-------------+--------------------------------+-------------+',
        '| [图层显隐]         [◀单步] [▶播放/暂停] [复位]   [进入练习]|',
        '+------------------------------------------------------------+'
      ].join('\n'),
      psdLayersZh:
        '01_Header_Ornaments（顶栏面包屑与标题纹样） / 02_Interactive_Controls（播放控制按钮组、图层切换开关、搜索框组件） / 03_Panels_Containers（左中右三栏 9-slice 九宫格容器底板、详情卡片底框） / 04_Backdrop（全屏工作台环境底图）',
      boundMetrics: ['selectedEntityId', 'layerMaskState', 'demoStepIndex']
    },
    {
      id: 'ui_univ_eval_panel',
      titleZh: '实训测评答题与进度状态界面',
      titleEn: 'Assessment & Practice Workspace',
      screenKind: 'fullscreen',
      aspectRatio: '16:9',
      regionsZh: [
        '顶栏测评状态区（占高 8%，Top-Stretch）：题组名称、当前进度、倒计时与草稿保存状态指示',
        '左侧题干与交互作答区（占宽 74%，Center-Left）：题干描述、选项列表或模型点选视口',
        '右侧答题卡与规则摘要区（占宽 26%，Center-Right）：题号矩阵（已答/未答/标记）与提交按钮'
      ],
      controlsZh: [
        '答题选项卡片：默认未选态 / 悬停描边态 / 选中态 / 已结算锁定态 / 保存异常重试态',
        '交卷主按钮：默认可提交态 / 按下态 / 二次确认弹窗态 / 提交中防重禁用态'
      ],
      wireframeAscii: [
        '+------------------------------------------------------------+',
        '| [测评模式]  进度: 08 / 20           [已自动保存] [⏱ 14:25] |',
        '+-------------------------------------------+----------------+',
        '| 【题干】请根据当前展示结构选择正确选项：  | [答题卡矩阵]   |',
        '|  (A) 选项内容一                           | [01][02][03]...|',
        '|  (B) 选项内容二                           |                |',
        '|  (C) 选项内容三                           | [计分规则摘要] |',
        '+-------------------------------------------+----------------+',
        '| [上一题]  [⭐标记复查]            [下一题]   (( 提交试卷 ))|',
        '+------------------------------------------------------------+'
      ].join('\n'),
      psdLayersZh:
        '01_Header_Ornaments（计时器外框与进度条装饰） / 02_Interactive_Controls（选项七态组件、题号格子、上下题与提交主按钮） / 03_Panels_Containers（题干区与答题卡 9-slice 九宫格底框） / 04_Backdrop（专注模式底层背景）',
      boundMetrics: ['questionIndex', 'remainingSeconds', 'draftSyncState']
    },
    {
      id: 'ui_univ_result_popup',
      titleZh: '测评结算报告与异常确认弹窗',
      titleEn: 'Result Summary & Confirmation Modal',
      screenKind: 'popup',
      aspectRatio: '16:9',
      regionsZh: [
        '弹窗标题与总评徽章区（Top-Center）：展示完成状态、总分、正确率与用时统计',
        '中部知识点掌握度与错题摘要区（Center）：分维度得分条与待巩固条目列表',
        '底部操作按钮区（Bottom-Center）：导出报告、错题复盘与返回主场景按钮'
      ],
      controlsZh: [
        '主确认/继续按钮：默认高亮态 / 悬停态 / 按下态 / 导出加载态',
        '错题定位条目：默认态 / 悬停态 / 点击跳转对应知识详情态'
      ],
      wireframeAscii: [
        '+--------------------------------------------+',
        '|          ★ 阶段测评结算报告 ★              |',
        '|     总分: 92 / 100     耗时: 06分18秒      |',
        '|  +--------------------------------------+  |',
        '|  | 维度A掌握度: [████████████░░] 88%    |  |',
        '|  | 维度B掌握度: [██████████████] 96%    |  |',
        '|  +--------------------------------------+  |',
        '|     [导出报告]   [错题复盘]   (( 完成 ))   |',
        '+--------------------------------------------+'
      ].join('\n'),
      psdLayersZh:
        '01_Header_Ornaments（完成勋章与标题横幅） / 02_Interactive_Controls（完成主按钮、导出与复盘次级按钮、关闭按钮） / 03_Panels_Containers（居中模态弹窗 9-slice 九宫格底板、半透明遮罩层）',
      boundMetrics: ['totalScore', 'accuracyPct', 'elapsedSeconds']
    }
  ]
}

export const GAME_SYSTEM_ARCHETYPES: GameSystemArchetypeProfile[] = [
  ARCHETYPE_RPG,
  ARCHETYPE_CARD_DBG,
  ARCHETYPE_GACHA_LOOT,
  ARCHETYPE_AVG_MYSTERY,
  ARCHETYPE_SURVIVOR,
  ARCHETYPE_RULE_HORROR,
  ARCHETYPE_SLG_INTRIGUE,
  ARCHETYPE_UNIVERSAL
]

export const GAME_SYSTEM_ARCHETYPE_IDS: GameSystemArchetypeId[] = GAME_SYSTEM_ARCHETYPES.map(
  (a) => a.id
)

export function isGameSystemArchetypeId(raw: unknown): raw is GameSystemArchetypeId {
  return typeof raw === 'string' && (GAME_SYSTEM_ARCHETYPE_IDS as string[]).includes(raw)
}

export function resolveGameSystemArchetype(id?: string | null): GameSystemArchetypeProfile {
  if (id && isGameSystemArchetypeId(id)) {
    return GAME_SYSTEM_ARCHETYPES.find((a) => a.id === id) ?? ARCHETYPE_RPG
  }
  return ARCHETYPE_RPG
}

export const getGameSystemArchetype = resolveGameSystemArchetype

export function serializeMxNumericContextForDownstream(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return ''
  const d = doc as { workbench?: unknown }
  return JSON.stringify({
    kind: 'machinations_economy_bundle',
    document: doc,
    workbench: d.workbench
  })
}

export function inferGameSystemArchetypeFromContext(opts: {
  prompt?: string
  novelGenre?: string
  economyPreset?: string
  workbenchPreset?: string
}): GameSystemArchetypeId {
  const genre = (opts.novelGenre ?? '').trim().toLowerCase()
  const rawPrompt = (opts.prompt ?? '').trim().toLowerCase()
  const shortPrompt = rawPrompt.length <= 240 ? rawPrompt : ''

  const matchFromText = (s: string): GameSystemArchetypeId | null => {
    if (!s) return null
    if (
      /教学|教育|实训|题库|数字孪生|展厅|博物馆|医疗|中医|针灸|科普|仿真|虚拟空间|导览|课件|培训|simulation|education|training|digital.?twin/.test(
        s
      )
    ) {
      return 'universal_full_ui'
    }
    if (/怪谈|理智|san值|克苏鲁|收容|rule_horror|lovecraft/.test(s)) return 'rule_horror_sanity'
    if (/悬疑|推理|搜证|刑侦|影游|宫斗|avg|mystery|detective|romance/.test(s))
      return 'avg_mystery_branch'
    if (/权谋|朝堂|内阁|外交|slg|historical_intrigue/.test(s)) return 'slg_faction_intrigue'
    if (/割草|幸存者|波次|尸潮|废土|survivor|scifi_apocalypse/.test(s)) return 'roguelike_survivor'
    if (/抽卡|卡池|御魂|gacha|onmyoji/.test(s)) return 'gacha_equipment_loot'
    if (/卡牌|构筑|牌库|杀戮尖塔|炉石|小丑牌|dbg|deck|slay_the_spire|balatro|hearthstone/.test(s))
      return 'card_dbg_combat'
    if (/修仙|玄幻|突破|境界|养成|角色扮演|rpg|xianxia/.test(s)) return 'rpg_progression'
    if (/全套|总纲|大厅|universal/.test(s)) return 'universal_full_ui'
    return null
  }

  // 1. 短指令（用户显式指定）最高优先级
  const fromShortPrompt = matchFromText(shortPrompt)
  if (fromShortPrompt) return fromShortPrompt

  // 2. 显式小说题材流派映射
  const fromGenre = matchFromText(genre)
  if (fromGenre) return fromGenre

  // 3. 经济系统/数值工作台预设或长上下文兜底
  const combined =
    `${rawPrompt} ${genre} ${opts.economyPreset ?? ''} ${opts.workbenchPreset ?? ''}`.toLowerCase()
  return matchFromText(combined) ?? 'rpg_progression'
}

/**
 * 将上游 `game.economy` 节点的输出包解包为面向 `asset.gameSystem`（系统策划案）的
 * 【工程级数值公式、概率表、战斗状态机与 UI 数据绑定规范】。
 * 若输入不是 `game.economy` JSON 包，则原样返回。
 */
export function unwrapEconomyBundleForGameSystem(
  rawText: string,
  options?: {
    archetypeId?: GameSystemArchetypeId
    locale?: string
  }
): string {
  const trimmed = (rawText ?? '').trim()
  if (!trimmed.startsWith('{')) return rawText
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return rawText

    let rawWb: unknown = null
    if (parsed.kind === 'machinations_economy_bundle') {
      const docObj = parsed.document as { workbench?: unknown } | undefined
      rawWb = docObj?.workbench ?? parsed.workbench
    } else if (parsed.kind === 'aiart.machinations.economy.bundle.v1') {
      const docObj = parsed.doc as { workbench?: unknown } | undefined
      rawWb = parsed.workbench ?? docObj?.workbench
    } else if (parsed.workbench || parsed.workbenchReport || parsed.schema === 'mx@2') {
      rawWb = parsed.workbench
    }

    if (
      !rawWb &&
      !parsed.workbenchReport &&
      parsed.kind !== 'machinations_economy_bundle' &&
      parsed.schema !== 'mx@2'
    ) {
      return rawText
    }

    const wb = rawWb
      ? normalizeMxNumericalWorkbench(rawWb)
      : createMxWorkbenchPreset('short_drama_progression')
    if (wb.domainTables?.enabled && wb.domainTables.tables.length > 0) {
      return exportDomainNumericalSuiteMarkdown(wb.domainTables)
    }
    const multAnalysis = analyzeMultiplierPipeline(wb.multiplier)
    const lootSim = runMxLootAndSubstatSimulation({
      ...wb.lootRoll,
      runs: Math.min(120, Math.max(40, wb.lootRoll.runs || 80))
    })
    const combatSim = runMxCombatKernelSimulation({
      ...wb.combatKernel,
      runs: Math.min(120, Math.max(40, wb.combatKernel.runs || 80))
    })
    const envSim = runMxRoguelikeEnvelopeSimulation({
      ...wb.roguelikeEnvelope,
      runs: Math.min(120, Math.max(40, wb.roguelikeEnvelope.runs || 80))
    })
    const lethalRes = solveMxSingleTurnLethalAndOrderSkill(wb)
    const arch = resolveGameSystemArchetype(options?.archetypeId)

    const attrRows = wb.multiplier.attributes
      .map((a) => {
        const mItem = multAnalysis.marginalReturns.find((m) => m.attrName === a.name)
        return `  - \`${a.name}\` (${a.label}): 基准值=\`${a.value}\` [${a.min}~${a.max}], 边际收益ROI=\`${(mItem?.marginalRoiPct ?? 0).toFixed(2)}%\`${mItem?.isOptimalNextPick ? ' ★最优收益拐点' : ''}`
      })
      .join('\n')

    const stageRows = wb.multiplier.stages
      .map(
        (s) =>
          `  - 阶段 \`${s.name}\`: \`${s.formula}\` (计算值=\`${multAnalysis.stageValues[s.name] ?? 0}\`)`
      )
      .join('\n')

    const entityRows = wb.multiplier.entities
      .map((e) => {
        const statPairs = Object.entries(e.stats)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')
        return `  - **${e.name}** (\`${e.rarity}\`, Cost=${e.cost}): ${statPairs}`
      })
      .join('\n')

    const loot = wb.lootRoll
    const substatPool = loot.substatPool
      .map((s) => `${s.name}[档位=${s.rollTiers.join('/')}, 权重=${s.weight}]`)
      .join('、')

    const floorRows = envSim.floorSeries
      .filter(
        (_, i) =>
          i === 0 ||
          i === Math.floor(envSim.floorSeries.length / 2) ||
          i === envSim.floorSeries.length - 1
      )
      .map(
        (pt) =>
          `  - 阶段/层数 #${pt.floor}: 玩家中位战力=\`${pt.playerP50}\` vs 敌方膨胀墙=\`${pt.enemyPower}\` (状态=${pt.status === 'difficulty_wall' ? '⚠️ 高压卡点墙' : '✅ 正常推进'})`
      )
      .join('\n')

    return [
      `## 📊 【上游经济系统（game.economy）➔ 游戏系统策划案（asset.gameSystem）数值与配置契约】`,
      `- **数值体系名称**: ${wb.multiplier.title}（适配策划模板：${arch.icon} ${arch.labelZh}）`,
      `- **1. 核心乘区结算公式 (Multiplier Pipeline)**:`,
      `  - 最终结算表达式: \`${wb.multiplier.finalFormula}\``,
      `  - 标准单次结算期望值: \`${multAnalysis.finalOutput.toFixed(1)}\`（最优连招序列：\`${lethalRes.optimalSequenceLabel}\`）`,
      stageRows,
      attrRows,
      `- **2. 角色/卡牌/装备属性预算与标准实体表 (Entity Budget Table)**:`,
      entityRows,
      `- **3. 抽卡/掉宝概率与软硬保底规则 (Gacha Pity & Substat Drop Spec)**:`,
      `  - 抽卡保底参数: 基础SSR率=\`${loot.baseSsrRatePct}%\`, 软保底起始=\`第${loot.softPityStart}抽\`, 硬保底必出=\`第${loot.hardPityPull}抽\`, 大小保底机制=\`${loot.upGuarantee5050 ? '50/50歪后必出UP' : '直出'}\`, 期望出金抽数=\`${lootSim.attemptsMean.toFixed(1)}抽\``,
      `  - 装备副属性词条池 (目标词条=${loot.targetSubstatName} >= ${loot.targetSubstatThreshold}): ${substatPool}`,
      `- **4. 战斗内核与关卡成长包络墙 (Combat Kernel & Progression Envelope)**:`,
      `  - 战斗内核模式: \`${wb.combatKernel.kernel}\` · 模拟胜率=\`${combatSim.winRatePct}%\` · 平均回合数=\`${combatSim.ttkMean}\``,
      floorRows,
      `- **5. UI 界面必须绑定的动态数值字段 (UI Data-Binding Contract)**:`,
      `  - 请在 \`# 功能点设计\` 与 \`# UI 布局设计\` 中显式绑定以上乘区变量、保底计数器（\`pityCounter / ${loot.hardPityPull}\`）、实体属性与关卡压迫阈值！`
    ].join('\n')
  } catch {
    return rawText
  }
}

export interface NovelIpContextExtractOptions {
  novelText?: string
  novelGenre?: string
  novelGenreId?: string
  worldBible?: string
  stateLedger?: string
  characterRosterJson?: string
  foreshadowingJson?: string
  totalChapters?: number
  customStagesText?: string
  customAxisProtagonist?: string
  customAxisAntagonist?: string
  customUnlockTerm?: string
}

/**
 * 从上游 `asset.novel` 节点参数或小说正文中提取结构化【小说 IP 改编游戏系统映射规格】：
 * - 流派阶段阶梯 ➔ 角色境界/职级养成突破表
 * - 人物生死与仇恨名录 ➔ 可抽卡同伴池（Ally）与章节守关 Boss 表（Villain）
 * - 准入/终局解锁物与奇遇信物 ➔ 核心装备/法宝/线索收集系统
 * - 长线伏笔与章节冲突 ➔ 主线副本关卡与分支任务事件表
 */
export function extractNovelIpContextForGameSystem(opts: NovelIpContextExtractOptions): string {
  const rawText = (opts.novelText ?? '').trim()
  const detectedGenreId =
    opts.novelGenre?.trim() ||
    opts.novelGenreId?.trim() ||
    inferNovelGenreFromText(`${rawText.slice(0, 600)} ${opts.worldBible ?? ''}`) ||
    'urban_reversal'
  const profile =
    resolveNovelGenreProfile(detectedGenreId, {
      stagesText: opts.customStagesText,
      axisProtagonist: opts.customAxisProtagonist,
      axisAntagonist: opts.customAxisAntagonist,
      unlockTerm: opts.customUnlockTerm
    }) ?? resolveNovelGenreProfile('urban_reversal')!

  const titleMatch = /小说名：《?([^》\n]+)》?/.exec(rawText)
  const novelTitle = titleMatch?.[1]?.trim() || `${profile.labelZh.split(' / ')[0]}原著IP`
  const totalChaps = Math.max(1, opts.totalChapters || 800)

  let roster: MxNovelCharacterStatusEntry[] = normalizeNovelCharacterRoster(
    opts.characterRosterJson
  )
  if (!roster.length) {
    roster = profile.roster.map((r, idx) => ({
      id: `char_${idx}`,
      name: r.name,
      faction: r.faction,
      realmOrRole: r.role,
      status: 'active',
      relationNote: r.note,
      updatedAtChapter: 1
    }))
  }

  const foreshadowings: MxNovelForeshadowingEntry[] = normalizeNovelForeshadowingPool(
    opts.foreshadowingJson,
    totalChaps
  )

  const allies = roster.filter((c) => c.faction === 'protagonist' || c.faction === 'ally')
  const villains = roster.filter((c) => c.faction === 'villain')

  const lines: string[] = [
    `## 📚 【上游小说 IP（asset.novel）➔ 游戏系统策划案（asset.gameSystem）世界观与关卡转化规格】`,
    `- **原著 IP 名称**: 《${novelTitle}》（题材流派：${profile.icon} ${profile.labelZh} · 规划总规模：${totalChaps} 章）`,
    `- **1. 叙事阶梯 ➔ 游戏养成等级/突破阶位映射 (${profile.stageTermZh}系统)**:`,
    `  - 阶位晋升序列: ${profile.stageNamesZh.map((s, i) => `Stage ${i + 1}【${s}】`).join(' ➔ ')}`,
    `  - 双轴对抗指标: 玩家成长轴 = **${profile.protagonistAxisZh}** vs 关卡阻力轴 = **${profile.antagonistAxisZh}**`,
    `- **2. 原著人物名录 ➔ 可操控角色/卡池伙伴与副本 Boss 映射**:`,
    ...allies.map(
      (c) =>
        `  - 🌟 **核心可操控角色/SSR伙伴【${c.name}】**（定位：${c.realmOrRole}）：${c.relationNote}`
    ),
    ...villains.map(
      (c) =>
        `  - 💀 **章节守关 Boss/宿敌【${c.name}】**（定位：${c.realmOrRole}，当前状态：${c.status === 'eliminated' ? '已通关伏诛' : '活跃守关'}）：${c.relationNote}`
    ),
    `- **3. 原著${profile.unlockTermZh}与${profile.encounterTermZh} ➔ 游戏装备/技能/关键道具池映射**:`,
    `  - 核心${profile.unlockTermZh}池（技能/专武/铁证）：${profile.unlockItemsZh.map((u) => `【${u}】`).join('、')}`,
    `  - 奇遇${profile.encounterTermZh}池（掉落材料/副本线索）：${profile.encounterItemsZh.map((e) => `【${e}】`).join('、')}`
  ]

  if (opts.worldBible?.trim()) {
    lines.push(
      `- **4. 原著 L1 世界观核心法则（策划案系统规则严禁违背）**:`,
      ...opts.worldBible
        .trim()
        .split(/\r?\n/)
        .slice(0, 4)
        .map((l) => `  ${l.trim()}`)
    )
  }

  if (opts.stateLedger?.trim()) {
    lines.push(
      `- **4.5. 原著 L2 当前连载推进状态与已解锁底牌账本**:`,
      ...opts.stateLedger
        .trim()
        .split(/\r?\n/)
        .slice(0, 5)
        .map((l) => `  ${l.trim()}`)
    )
  }

  if (foreshadowings.length > 0) {
    lines.push(
      `- **5. 长线伏笔暗线 ➔ 游戏隐藏支线/高难秘境事件映射**:`,
      ...foreshadowings
        .slice(0, 3)
        .map(
          (f) =>
            `  - 隐藏支线《${f.title}》（解锁区间：第 ${f.targetPayoffChapterRange[0]}~${f.targetPayoffChapterRange[1]} 章对应副本）：${f.payoffHint}`
        )
    )
  }

  return lines.join('\n')
}

export interface SynthesizeGameSystemDocOptions {
  archetypeId?: GameSystemArchetypeId | string
  archetype?: GameSystemArchetypeProfile
  instruction?: string
  customInstruction?: string
  incomingText?: string
  economyText?: string
  novelText?: string
  wb?: MxNumericalWorkbench
  novelIpSpec?: string
  targetAspect?: '9:16' | '16:9' | '1:1'
}

/**
 * 确定性离线合成器：当无大模型 API 或测试环境运行时，
 * 自动融合上游 `game.economy` 数值模型与 `asset.novel` IP 设定，
 * 生成结构严谨、可直接被下游 `ui.split` 拆解出多张独立 UI 界面的完整系统策划案。
 */
export function synthesizeGameSystemDocOffline(opts: SynthesizeGameSystemDocOptions): string {
  const instr = opts.customInstruction ?? opts.instruction ?? ''
  const combinedIncoming =
    `${opts.incomingText ?? ''}\n${opts.economyText ?? ''}\n${opts.novelText ?? ''}`.trim()
  const arch =
    opts.archetype ??
    (opts.archetypeId && isGameSystemArchetypeId(opts.archetypeId)
      ? resolveGameSystemArchetype(opts.archetypeId)
      : resolveGameSystemArchetype(
          inferGameSystemArchetypeFromContext({
            prompt: `${instr} ${combinedIncoming}`
          })
        ))

  const hasExplicitEconomyOrCombat =
    Boolean(opts.wb) ||
    Boolean(opts.economyText?.trim()) ||
    /machinations_economy_bundle|核心乘区结算公式/.test(combinedIncoming) ||
    arch.id !== 'universal_full_ui'

  const screenBlocks = arch.defaultScreens
    .map((scr, idx) => {
      const aspect = opts.targetAspect || scr.aspectRatio
      return [
        `## 4.${idx + 1} ${scr.titleZh}（\`${scr.id}\`）`,
        `- **界面规格**：界面形态 \`screenKind: ${scr.screenKind}\` · 建议画幅比例 \`aspectRatio: ${aspect}\``,
        `- **绑定数值指标**：${scr.boundMetrics.map((m) => `\`${m}\``).join('、')}`,
        `- **界面结构（ASCII 字符框线布局草图）**：`,
        '```text',
        scr.wireframeAscii,
        '```',
        `- **区域划分**：`,
        ...scr.regionsZh.map((r) => `  - ${r}`),
        `- **控件清单与 7 状态规范（默认 / 悬停 / 按下 / 禁用 / 加载 / 空态 / 错误）**：`,
        ...scr.controlsZh.map((c) => `  - ${c}`),
        `- **PSD 图层拆分与九宫格（9-slice）规范**：`,
        `  - ${scr.psdLayersZh}`
      ].join('\n')
    })
    .join('\n\n')

  const extraContextBlock =
    opts.novelIpSpec?.trim() ||
    (combinedIncoming ? `\n## 6.2 上游输入与联动数据契约\n${combinedIncoming}\n` : '')

  // 非战斗/通用交互仿真模式（未连接经济/数值节点时，绝不硬塞短剧逆袭/战斗/抽卡数值）
  if (!hasExplicitEconomyOrCombat) {
    const neutralFeatureBlocks = arch.defaultFeatures
      .map((f, idx) =>
        [
          `## 3.${idx + 1} [${f.id}] ${f.nameZh}（优先级：${f.priority}）`,
          `- **功能编号与名称**：\`${f.id}\` · ${f.nameZh} (${f.nameEn})`,
          `- **触发方式与入口**：${f.triggerZh}`,
          `- **规则描述（流程、状态机与计分公式）**：`,
          `  - ${f.rulesZh}`,
          `  - 绑定核心测评结算公式：\`TotalScore = Σ(itemWeight_i × accuracy_i)\`（标准通过期望阈值：\`>= 80.0\`）`,
          `- **优先级**：\`${f.priority}\`（核心必做闭环）`,
          `- **边界与异常处理**：${f.edgeCasesZh}`
        ].join('\n')
      )
      .join('\n\n')

    return [
      `# 系统概述`,
      `- **系统名称与品类定位**：${arch.icon} **${arch.labelZh}**（\`${arch.id}\`）`,
      ...(instr ? [`- **定制策划要求**：${instr}`] : []),
      `- **核心交互循环（Core Loop）**：${arch.coreLoopZh}`,
      `- **上下游模块耦合关系**：`,
      `  - 上游承接业务需求说明、领域知识库、三维/多媒体内容清单与配置规范；`,
      `  - 下游直接驱动 **UI 界面拆分 (\`ui.split\`) ➔ UI 界面生成 (\`ui.gen\`) ➔ UI 图层分离 (\`image.layerSplit\`)** 与交互原型验证。`,
      ``,
      `# 系统目标`,
      `- **用户体验目标**：${arch.playerGoalZh}`,
      `- **工程交付设计目标**：${arch.designGoalZh}`,
      `- **可验证验收标准（Acceptance Criteria）**：`,
      `  1. 本地有效交互视觉反馈延迟 \`P95 <= 50ms\`，连续运行无黑屏或焦点死锁；`,
      `  2. 核心任务全流程首次独立完成率期望 \`>= 90%\`，空态与错误态覆盖率 \`100%\`；`,
      `  3. 测评计分结算公式精度与幂等提交一致性 \`100%\`，重复提交零脏数据。`,
      ``,
      `# 功能点设计`,
      neutralFeatureBlocks,
      ``,
      `# UI 布局设计`,
      screenBlocks,
      ``,
      `# UI 要求`,
      `- **视觉层级与一致性**：严格区分底层环境背景（Backdrop）、九宫格可拉伸容器面板（9-Slice Containers）、顶栏装饰横幅（Ornaments）与高频交互控件（Interactive Controls），不要指定颜色，由下游统一美术风格参考图决定色板。`,
      `- **栅格与多分辨率安全区**：采用 8pt 基准栅格；竖屏（9:16）顶部预留 44px 安全区、底部预留 34px 手势条安全区；横屏（16:9）左右两侧预留 48px 安全边距。`,
      `- **交互触控与动效反馈**：所有可点击控件最小热区不小于 \`48×48px\`；按下态 80ms 视觉反馈，同命令 300ms 去重防抖。`,
      ``,
      `# 数据与配置`,
      `## 6.0 核心交互性能阈值与测评结算公式`,
      `- **测评计分结算公式**：\`TotalScore = Σ(itemWeight_i × accuracy_i)\`（满分 \`100\`，达标期望阈值 \`80\`）`,
      `- **交互与请求边界阈值**：点击防抖窗口 \`300ms\`，业务接口超时 \`8000ms\`，失败自动重试上限 \`2\` 次`,
      ``,
      `## 6.1 核心业务实体与配置结构表`,
      `| 实体ID | 模块名称 | 发布级别 | 版本策略 | 核心配置字段明细 |`,
      `| :--- | :--- | :--- | :--- | :--- |`,
      `| \`hub_scene_cfg\` | 主场景与分区导航配置 | required | versioned | sceneId / cameraPreset / entryHotspots / preloadAssets |`,
      `| \`interact_unit_cfg\` | 核心交互对象与分层元数据 | required | versioned | unitId / modelRef / layerMask / anchorPoints / sourceRefs |`,
      `| \`eval_rule_cfg\` | 实训测评题组与计分规则 | required | snapshot | paperId / questionIds / scoringFormula / durationSec |`,
      `| \`session_log_cfg\` | 会话进度与幂等归档记录 | standard | idempotent | sessionId / eventId / progressPct / totalScore / syncedAt |`,
      extraContextBlock,
      `# 开放问题与风险`,
      `- **内容与资产版本一致性**：三维模型锚点、图谱资源与业务题库需绑定固定发布版本号，未审核草稿严禁直接下发客户端。`,
      `- **UI 图层切分规范**：下游 \`image.layerSplit\` 进行九宫格切图时，需确保 \`03_Panels_Containers\` 层边框四角装饰与中间拉伸区边界清晰无遮挡。`
    ]
      .filter(Boolean)
      .join('\n')
  }

  // 未连接上游机制设计 / 数值系统时：只按系统原型输出题材中立的数值占位，
  // 绝不回落到某个具体 IP 预设（如短剧逆袭的「至尊黑卡 / 江城首富」）污染无关策划案。
  if (!opts.wb) {
    const featureBlocksNoWb = arch.defaultFeatures
      .map((f, idx) =>
        [
          `## 3.${idx + 1} [${f.id}] ${f.nameZh}（优先级：${f.priority}）`,
          `- **功能编号与名称**：\`${f.id}\` · ${f.nameZh} (${f.nameEn})`,
          `- **触发方式与入口**：${f.triggerZh}`,
          `- **规则描述（流程、条件、结算公式）**：`,
          `  - ${f.rulesZh}`,
          `  - 结算公式：待接入上游「机制设计 / 数值系统」后自动绑定（当前为占位）`,
          `- **优先级**：\`${f.priority}\``,
          `- **边界与异常处理**：${f.edgeCasesZh}`
        ].join('\n')
      )
      .join('\n\n')

    const metricRows = Array.from(
      new Map(
        arch.defaultScreens.flatMap((scr) => scr.boundMetrics.map((m) => [m, scr.titleZh] as const))
      ).entries()
    )
      .map(
        ([metric, screenTitle]) => `| \`${metric}\` | ${screenTitle} | 待配置 | 待接入数值系统 |`
      )
      .join('\n')

    return [
      `# 系统概述`,
      `- **系统名称与品类定位**：${arch.icon} **${arch.labelZh}**（\`${arch.id}\`）`,
      ...(instr ? [`- **定制策划要求**：${instr}`] : []),
      `- **核心玩法循环（Core Loop）**：${arch.coreLoopZh}`,
      `- **上下游系统耦合关系**：`,
      `  - 上游可选接入 **机制设计 (\`game.economy\`)**、**数值系统 (\`game.numerical\`)** 与 **小说 IP (\`asset.novel\`)**，接入后自动注入结算公式、配表与世界观设定；`,
      `  - 下游驱动 **UI 界面拆分 (\`ui.split\`) ➔ UI 界面生成 (\`ui.gen\`) ➔ UI 图层分离 (\`image.layerSplit\`)** 或 **图集拼装 UI (\`ui.atlasCompose\`)**。`,
      ``,
      `# 系统目标`,
      `- **玩家体验目标**：${arch.playerGoalZh}`,
      `- **设计目标**：${arch.designGoalZh}`,
      `- **可验证验收标准（Acceptance Criteria）**：`,
      `  1. 核心结算公式与数值配表一致，结算精度误差 \`< 0.01%\`；`,
      `  2. 概率类玩法（掉落 / 抽取）的保底与期望参数需与数值配表对齐并可复现；`,
      `  3. 核心流程首次独立完成率期望 \`>= 90%\`，空态与错误态覆盖率 \`100%\`。`,
      ``,
      `# 功能点设计`,
      featureBlocksNoWb,
      ``,
      `# UI 布局设计`,
      screenBlocks,
      ``,
      `# UI 要求`,
      `- **视觉层级与一致性**：严格区分底层环境背景（Backdrop）、九宫格可拉伸容器面板（9-Slice Containers）、顶栏装饰横幅（Ornaments）与高频交互控件（Interactive Controls），不要指定颜色，由下游统一美术风格参考图决定色板。`,
      `- **栅格与多分辨率安全区**：采用 8pt 基准栅格；竖屏（9:16）顶部预留 44px 刘海安全区、底部预留 34px 手势条安全区；横屏（16:9）左右两侧预留 48px 安全边距。`,
      `- **交互触控与动效反馈**：所有可点击按钮最小热区不小于 \`48×48px\`；按下态 80ms 缩放反馈，同命令 300ms 去重防抖。`,
      ``,
      `# 数据与配置`,
      `## 6.0 核心结算公式与概率参数`,
      `- **核心结算公式**：待接入上游机制设计 / 数值系统后自动注入`,
      `- **概率与保底参数**：待配置（如存在掉落 / 抽取玩法，需给出基础概率、软保底起点与硬保底抽数）`,
      ``,
      `## 6.1 界面绑定数值指标配置表`,
      `| 指标ID | 所属界面 | 默认值 | 来源 |`,
      `| :--- | :--- | :--- | :--- |`,
      metricRows,
      extraContextBlock,
      `# 开放问题与风险`,
      `- **数值配表缺失**：当前未连接上游数值系统，公式与配表为占位，正式交付前需接入或补全。`,
      `- **UI 图层切分规范**：下游 \`image.layerSplit\` 进行九宫格切图时，需确保 \`03_Panels_Containers\` 层边框四角装饰与中间拉伸区边界清晰无遮挡。`
    ]
      .filter(Boolean)
      .join('\n')
  }

  const wb = opts.wb
  const multAnalysis = analyzeMultiplierPipeline(wb.multiplier)
  const lootSim = runMxLootAndSubstatSimulation({ ...wb.lootRoll, runs: 60 })
  const combatSim = runMxCombatKernelSimulation({ ...wb.combatKernel, runs: 60 })

  const featureBlocks = arch.defaultFeatures
    .map((f, idx) =>
      [
        `## 3.${idx + 1} [${f.id}] ${f.nameZh}（优先级：${f.priority}）`,
        `- **功能编号与名称**：\`${f.id}\` · ${f.nameZh} (${f.nameEn})`,
        `- **触发方式与入口**：${f.triggerZh}`,
        `- **规则描述（流程、条件、结算公式）**：`,
        `  - ${f.rulesZh}`,
        `  - 绑定核心结算公式：\`${wb.multiplier.finalFormula}\`（单次标准期望：\`${multAnalysis.finalOutput.toFixed(1)}\`）`,
        `- **优先级**：\`${f.priority}\`（核心必做闭环）`,
        `- **边界与异常处理**：${f.edgeCasesZh}`
      ].join('\n')
    )
    .join('\n\n')

  const entityTableRows = wb.multiplier.entities
    .map((e) => {
      const statStr = Object.entries(e.stats)
        .map(([k, v]) => `${k}:${v}`)
        .join(' / ')
      return `| \`${e.id}\` | ${e.name} | ${e.rarity} | ${e.cost} | ${statStr} |`
    })
    .join('\n')

  return [
    `# 系统概述`,
    `- **系统名称与品类定位**：${arch.icon} **${arch.labelZh}**（\`${arch.id}\` · 驱动数值体系：${wb.multiplier.title}）`,
    ...(instr ? [`- **定制策划要求**：${instr}`] : []),
    `- **核心玩法循环（Core Loop）**：${arch.coreLoopZh}`,
    `- **上下游系统耦合关系**：`,
    `  - 上游承接 **经济系统 (\`game.economy\`)** 的乘区结算管线（\`${wb.multiplier.finalFormula}\`）、抽卡保底概率与战斗内核（\`${wb.combatKernel.kernel}\`）；`,
    `  - 上游承接 **原著小说 (\`asset.novel\`)** 的世界观阶位体系、角色阵营名录与主线冲突章节；`,
    `  - 下游直接驱动 **UI 界面拆分 (\`ui.split\`) ➔ UI 界面生成 (\`ui.gen\`) ➔ UI 图层分离 (\`image.layerSplit\`)** 与可玩沙盒原型。`,
    ``,
    `# 系统目标`,
    `- **玩家体验目标**：${arch.playerGoalZh}`,
    `- **数值与商业化设计目标**：${arch.designGoalZh}`,
    `- **可验证验收标准（Acceptance Criteria）**：`,
    `  1. 乘区结算精度误差 \`< 0.01%\`，单回合最优序列期望输出稳定在 \`${multAnalysis.finalOutput.toFixed(1)}\`；`,
    `  2. 限定卡池软保底于第 \`${wb.lootRoll.softPityStart}\` 抽生效，硬保底第 \`${wb.lootRoll.hardPityPull}\` 抽 100% 必出，综合期望抽数 \`${lootSim.attemptsMean.toFixed(1)}\` 抽；`,
    `  3. 战斗内核模拟胜率保持在 \`${combatSim.winRatePct}%\` 区间，平均战斗时长 \`${combatSim.ttkMean}\` 回合。`,
    ``,
    `# 功能点设计`,
    featureBlocks,
    ``,
    `# UI 布局设计`,
    screenBlocks,
    ``,
    `# UI 要求`,
    `- **视觉层级与一致性**：严格区分底层环境背景（Backdrop）、九宫格可拉伸容器面板（9-Slice Containers）、顶栏装饰横幅（Ornaments）与高频交互控件（Interactive Controls），不要指定颜色，由下游统一美术风格参考图决定色板。`,
    `- **栅格与多分辨率安全区**：采用 8pt 基准栅格；竖屏（9:16）顶部预留 44px 刘海安全区、底部预留 34px 手势条安全区；横屏（16:9）左右两侧预留 48px 安全边距。`,
    `- **交互触控与动效反馈**：所有可点击按钮最小热区不小于 \`48×48px\`；按下态 80ms 缩放反馈，数值跳字采用弹簧缓动（Spring Ease-Out），高阶底牌解锁伴随屏幕微震与流光扫光。`,
    ``,
    `# 数据与配置`,
    `## 6.0 核心乘区结算公式与保底参数（绑定经济系统）`,
    `- **核心乘区结算公式**：\`${wb.multiplier.finalFormula}\`（基准单轮期望输出：\`${multAnalysis.finalOutput.toFixed(1)}\`）`,
    `- **抽卡与掉落保底参数**：软保底起始第 \`${wb.lootRoll.softPityStart}\` 抽，硬保底第 \`${wb.lootRoll.hardPityPull}\` 抽必出，综合期望 \`${lootSim.attemptsMean.toFixed(1)}\` 抽`,
    ``,
    `## 6.1 标准角色与宿敌属性配置表（源自经济系统工作台）`,
    `| 实体ID | 名称 | 稀有度 | 费用/阶位 | 核心属性明细 |`,
    `| :--- | :--- | :--- | :--- | :--- |`,
    entityTableRows,
    extraContextBlock,
    `# 开放问题与风险`,
    `- **数值膨胀风险**：跨幕次后期乘区叠加可能导致伤害数字过快膨胀，需在每幕守关 Boss 引入护甲减伤阈值与阶段护盾机制。`,
    `- **UI 图层切分规范**：下游 \`image.layerSplit\` 进行九宫格切图时，需确保 \`03_Panels_Containers\` 层边框四角装饰与中间拉伸区边界清晰无遮挡。`
  ]
    .filter(Boolean)
    .join('\n')
}

export interface GameSystemUiScreenPreviewItem {
  id: string
  title: string
  screenKind: 'fullscreen' | 'hud' | 'popup' | 'panel' | 'component'
  aspectRatio: '9:16' | '16:9' | '1:1'
  hasWireframe: boolean
  hasPsdSpec: boolean
  wireframeSnippet: string
  promptSummary: string
}

export type GddSectionKey =
  'overview' | 'goals' | 'features' | 'uiLayout' | 'uiRequirements' | 'dataConfig'

export interface GddSectionSpan {
  key: GddSectionKey
  start: number
  headingEnd: number
  end: number
  level: number
  rawLine: string
}

const GDD_SECTION_LABELS: Record<GddSectionKey, { zh: string; en: string }> = {
  overview: { zh: '# 系统概述', en: '# System Overview' },
  goals: { zh: '# 系统目标', en: '# System Goals' },
  features: { zh: '# 功能点设计', en: '# Feature Design' },
  uiLayout: { zh: '# UI 布局设计', en: '# UI Layout Design' },
  uiRequirements: { zh: '# UI 要求', en: '# UI Requirements' },
  dataConfig: { zh: '# 数据与配置', en: '# Data & Configuration' }
}

/**
 * 识别策划案章节标题所属的 6 大标准章节 ID（兼容 `# 一、系统概述`、`# 1. 系统概述`、`# 四、界面清单与 UI 布局设计` 等模型常见编号变体）。
 */
export function matchGddHeadingSectionId(headingText: string): GddSectionKey | null {
  const clean = (headingText ?? '').replace(/^#+\s*/, '').trim()
  if (!clean) return null
  // 排除 3.1 / 4.2 / UI-01 / F01 / SYS-01 等子条目编号，避免子节被误判为顶层章节
  if (/^(?:\d+\.\d+|UI-\d+|F\d+\b|SYS-)/i.test(clean)) return null
  const stripped = clean
    .replace(/^(?:[（(]?第?[一二三四五六七八九十百\d]+[章节部分篇)）]?|[IVX]+)[.、:：\s）)-]*/i, '')
    .trim()

  if (
    /^(?:[^\n]{0,10})?(?:系统概述|项目概述|玩法概述|设计概述|总览与概述|System\s*Overview)/i.test(
      stripped
    )
  ) {
    return 'overview'
  }
  if (
    /^(?:[^\n]{0,10})?(?:系统目标|设计目标|体验目标|项目目标|核心目标|System\s*Goals|Design\s*Goals)/i.test(
      stripped
    )
  ) {
    return 'goals'
  }
  if (
    /^(?:[^\n]{0,12})?(?:功能点设计|功能模块|核心功能|功能设计|玩法规则|Feature\s*Design|Feature\s*Modules)/i.test(
      stripped
    )
  ) {
    return 'features'
  }
  if (
    /^(?:[^\n]{0,16})?(?:UI\s*布局设计|界面清单|界面布局|UI\s*界面设计|界面设计|UI\s*Layout)/i.test(
      stripped
    )
  ) {
    return 'uiLayout'
  }
  if (
    /^(?:[^\n]{0,16})?(?:UI\s*要求|UI\s*规范|交互与反馈规范|交互规范|美术与\s*UI|视觉与交互|UI\s*Requirements|UI\s*Specs|Interaction\s*(?:&|and)\s*Feedback)/i.test(
      stripped
    )
  ) {
    return 'uiRequirements'
  }
  if (
    /^(?:[^\n]{0,16})?(?:数据与配置|核心数值|数值与配置|配置表|数据表与配置|数据结构|Data\s*(?:&|and)\s*Config|Data\s*(?:&|and)\s*Formulas)/i.test(
      stripped
    )
  ) {
    return 'dataConfig'
  }
  return null
}

interface ScannedMdHeading {
  level: number
  text: string
  rawLine: string
  start: number
  lineEnd: number
}

function scanMarkdownHeadingsOutsideCodeFences(txt: string): ScannedMdHeading[] {
  const out: ScannedMdHeading[] = []
  let inFence = false
  let pos = 0
  while (pos <= txt.length) {
    const nl = txt.indexOf('\n', pos)
    const lineEnd = nl >= 0 ? nl : txt.length
    const rawLine = txt.slice(pos, lineEnd).replace(/\r$/, '')
    const trimmed = rawLine.trim()
    if (trimmed.startsWith('```')) {
      inFence = !inFence
    } else if (!inFence) {
      const m = /^(#{1,4})\s+(.+)$/.exec(trimmed)
      if (m) {
        out.push({
          level: m[1]!.length,
          text: m[2]!.trim(),
          rawLine: trimmed,
          start: pos,
          lineEnd
        })
      }
    }
    if (nl < 0) break
    pos = nl + 1
  }
  return out
}

/**
 * 在 Markdown 正文中定位指定标准章节的起止字符区间（跳过代码块内的 `#`）。
 */
export function findGddSectionSpan(docText: string, key: GddSectionKey): GddSectionSpan | null {
  const headings = scanMarkdownHeadingsOutsideCodeFences(docText)
  let hitIdx = headings.findIndex((h) => h.level === 1 && matchGddHeadingSectionId(h.text) === key)
  if (hitIdx < 0) {
    hitIdx = headings.findIndex((h) => h.level === 2 && matchGddHeadingSectionId(h.text) === key)
  }
  if (hitIdx < 0) return null
  const hit = headings[hitIdx]!
  let end = docText.length
  for (let i = hitIdx + 1; i < headings.length; i += 1) {
    if (headings[i]!.level <= hit.level) {
      end = headings[i]!.start
      break
    }
  }
  return {
    key,
    start: hit.start,
    headingEnd: hit.lineEnd,
    end,
    level: hit.level,
    rawLine: hit.rawLine
  }
}

export function isGlobalUiPreambleSubheading(rawHeading: string, block: string): boolean {
  if (
    !/(?:全局布局|通用规范|通用状态|通用七态|设计总则|全局规范|资产规则|Global\s*Layout|General\s*Rules)/i.test(
      rawHeading
    )
  ) {
    return false
  }
  const hasExplicitScreenKind = /screenKind\s*[:：]/i.test(block)
  const hasAsciiFence = /```(?:text|ascii)?\s*\n[\s\S]*?[+┌┐└┘─│]/i.test(block)
  return !hasExplicitScreenKind && !hasAsciiFence
}

/**
 * 检测由旧版「一键补全」在已有完整章节后误追加的默认 RPG/短剧尾部模板（`ui_rpg_realm_main` / `sd_endure`），
 * 返回该冗余尾部在全文中的起始偏移；若不存在或本身就是唯一正文章节则返回 `null`。
 */
export function detectPollutedLegacyRpgTailStart(docText: string): number | null {
  const txt = docText ?? ''
  if (!txt) return null
  const legacyUiRe =
    /\n# UI 布局设计\s*\n+## 4\.1 角色境界突破与属性总览主界面（`ui_rpg_realm_main`）/
  const legacyDataRe =
    /\n# 数据与配置\s*\n+## 6\.1 标准角色与宿敌属性配置表（源自经济系统工作台）\s*\n\|[^\n]*\n\|[^\n]*\n\|\s*`sd_endure`/
  const uiHit = legacyUiRe.exec(txt)
  const dataHit = legacyDataRe.exec(txt)
  const candidates = [uiHit?.index, dataHit?.index].filter(
    (idx): idx is number => typeof idx === 'number' && idx > 0
  )
  if (!candidates.length) return null
  const cutIdx = Math.min(...candidates)
  const head = txt.slice(0, cutIdx).trim()
  if (!head) return null
  const headHasOwnSections =
    Boolean(findGddSectionSpan(head, 'uiLayout')) || Boolean(findGddSectionSpan(head, 'dataConfig'))
  return headHasOwnSections ? cutIdx : null
}

export interface GameSystemDocumentAudit {
  overallScore: number
  sectionChecks: {
    overview: boolean
    goals: boolean
    features: boolean
    uiLayout: boolean
    uiRequirements: boolean
    dataConfig: boolean
  }
  featureCount: number
  hasPriorityTags: boolean
  hasEdgeCaseHandling: boolean
  hasNumericalFormulaBinding: boolean
  uiScreens: GameSystemUiScreenPreviewItem[]
  warningsZh: string[]
  warningsEn: string[]
}

/**
 * 实时审计系统策划案文档（`asset.gameSystem`），检查：
 * 1. 6 大核心章节完备度；
 * 2. 功能点 P0/P1/P2 优先级与异常边界处理；
 * 3. 经济系统数值公式与配置表绑定；
 * 4. 提取 `# UI 布局设计` 中的所有独立界面卡片，预检 `screenKind`、`aspectRatio`、ASCII 框线与 9-slice PSD 规范。
 */
export function auditGameSystemDocument(docText: string): GameSystemDocumentAudit {
  const txt = (docText ?? '').trim()
  const uiLayoutSpan = findGddSectionSpan(txt, 'uiLayout')
  const sectionChecks = {
    overview: Boolean(findGddSectionSpan(txt, 'overview')),
    goals: Boolean(findGddSectionSpan(txt, 'goals')),
    features: Boolean(findGddSectionSpan(txt, 'features')),
    uiLayout: Boolean(uiLayoutSpan),
    uiRequirements: Boolean(findGddSectionSpan(txt, 'uiRequirements')),
    dataConfig: Boolean(findGddSectionSpan(txt, 'dataConfig'))
  }

  const featureMatches = txt.match(/SYS-[A-Z0-9-]+|F\d{2,3}\b|##\s*3\.\d+|功能编号/g) ?? []
  const featureCount = Math.max(
    featureMatches.length,
    (txt.match(/优先级[：:]\s*`?P[012]/g) ?? []).length
  )
  const hasPriorityTags = /\bP0\b|\bP1\b|\bP2\b/.test(txt)
  const hasEdgeCaseHandling = /边界与异常|异常处理|断线|超时|不足|溢出|防抖|Edge cases/i.test(txt)
  const hasNumericalFormulaBinding =
    /乘区|公式|保底|ATK|HP|的概率|期望|计分规则|Formula|Multiplier|Pity/i.test(txt)

  // Extract UI Screens from `# UI 布局设计` section
  const uiScreens: GameSystemUiScreenPreviewItem[] = []
  const uiBody = uiLayoutSpan ? txt.slice(uiLayoutSpan.headingEnd, uiLayoutSpan.end) : txt
  const firstSubIdx = uiBody.search(/(?:^|\n)##+\s+/)
  const introText = firstSubIdx > 0 ? uiBody.slice(0, firstSubIdx) : ''
  let globalPsdInherited = /9-slice|九宫格|PSD/i.test(introText)

  const subHeadingRe = /(?:^|\n)##+\s*(?:4\.\d+\s*)?([^\n]+)\n([\s\S]*?)(?=\n##+\s+|\n#\s+|$)/g
  let m: RegExpExecArray | null
  let idx = 1
  while ((m = subHeadingRe.exec(uiBody)) !== null) {
    const rawHeading = m[1]!.trim()
    const block = m[2]!.trim()
    if (uiLayoutSpan && isGlobalUiPreambleSubheading(rawHeading, block)) {
      if (/9-slice|九宫格|PSD/i.test(block)) {
        globalPsdInherited = true
      }
      continue
    }
    if (
      !uiLayoutSpan &&
      !/screenKind|界面规格|界面结构|框线|HUD|弹窗|主界面|面板|9:16|16:9/i.test(
        `${rawHeading}\n${block}`
      )
    ) {
      continue
    }
    const kindMatch = /\b(fullscreen|hud|popup|panel|component)\b/i.exec(block)
    const screenKind = (kindMatch?.[1]?.toLowerCase() ??
      (/弹窗|modal|popup/i.test(rawHeading)
        ? 'popup'
        : /hud|战斗/i.test(rawHeading)
          ? 'hud'
          : /面板|panel/i.test(rawHeading)
            ? 'panel'
            : 'fullscreen')) as GameSystemUiScreenPreviewItem['screenKind']
    const aspectMatch = /\b(9:16|16:9|1:1)\b/.exec(block)
    const aspectRatio = (aspectMatch?.[1] ??
      (screenKind === 'popup' ? '1:1' : '16:9')) as GameSystemUiScreenPreviewItem['aspectRatio']

    const asciiMatch =
      /```(?:text|ascii)?\s*\n([\s\S]*?)```/.exec(block) ||
      /(\+[\-+]+\+[\s\S]*?\+[\-+]+\+)/.exec(block)
    const wireframeSnippet = asciiMatch?.[1]?.trim() ?? ''
    const hasWireframe = wireframeSnippet.length > 20 || /[+┌┐└┘├┤┬┴┼─│]/.test(block)
    const hasPsdSpec =
      /9-slice|九宫格|PSD|01_Header|02_Interactive|03_Panels|图层拆分|分层输出|独立分层|分别成组|分别输出|单独输出/i.test(
        block
      ) ||
      (globalPsdInherited && /(?:^|\n)\s*[-*•]?\s*(?:\*\*)?拆分/m.test(block))

    uiScreens.push({
      id: `scr_${idx}`,
      title: rawHeading.replace(/（`[^`]+`）|\(`[^`]+`\)/g, '').trim(),
      screenKind,
      aspectRatio,
      hasWireframe,
      hasPsdSpec,
      wireframeSnippet,
      promptSummary: block
        .replace(/```[\s\S]*?```/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 140)
    })
    idx += 1
  }

  let score = 0
  const warningsZh: string[] = []
  const warningsEn: string[] = []

  const sectionKeys = Object.keys(sectionChecks) as GddSectionKey[]
  const missingKeys = sectionKeys.filter((k) => !sectionChecks[k])
  const secCount = sectionKeys.length - missingKeys.length
  score += Math.round((secCount / 6) * 30)
  if (missingKeys.length > 0) {
    const missingZh = missingKeys.map((k) => GDD_SECTION_LABELS[k].zh).join(' / ')
    const missingEn = missingKeys.map((k) => GDD_SECTION_LABELS[k].en).join(' / ')
    warningsZh.push(`当前策划案包含 ${secCount}/6 个标准章节，建议补全缺失的「${missingZh}」章节。`)
    warningsEn.push(`Document has ${secCount}/6 standard GDD sections (missing: ${missingEn}).`)
  }

  if (hasPriorityTags && hasEdgeCaseHandling) {
    score += 20
  } else {
    score += hasPriorityTags || hasEdgeCaseHandling ? 10 : 0
    warningsZh.push('部分功能点缺少 P0/P1/P2 优先级标注或断线/连点/资源不足等边界异常处理说明。')
    warningsEn.push('Missing P0/P1/P2 priority tags or edge-case/error handling rules.')
  }

  if (hasNumericalFormulaBinding) {
    score += 20
  } else {
    warningsZh.push('策划案尚未显式绑定上游经济系统的乘区结算公式、实体属性表或抽卡保底参数。')
    warningsEn.push('Missing explicit numerical formula or economy parameter bindings.')
  }

  if (uiScreens.length >= 2) {
    score += 15
  } else if (uiScreens.length === 1) {
    score += 8
    warningsZh.push(
      '当前 # UI 布局设计 仅包含 1 个界面，建议至少规划主界面 + 战斗HUD/弹窗 2~4 个界面供下游拆分。'
    )
    warningsEn.push(
      'Only 1 UI screen detected; recommend defining 2-4 screens for downstream ui.split.'
    )
  } else {
    warningsZh.push('未检测到可被下游 ui.split 识别的 # UI 布局设计 子界面章节。')
    warningsEn.push('No parseable UI screens found under # UI Layout Design.')
  }

  const allHaveWireframeAndPsd =
    uiScreens.length > 0 && uiScreens.every((s) => s.hasWireframe && s.hasPsdSpec)
  if (allHaveWireframeAndPsd) {
    score += 15
  } else if (uiScreens.some((s) => s.hasWireframe || s.hasPsdSpec)) {
    score += 8
    warningsZh.push('部分 UI 界面缺少 ASCII 字符框线图或 9-slice 九宫格 PSD 图层拆分规范。')
    warningsEn.push('Some UI screens are missing ASCII wireframes or 9-slice PSD layer specs.')
  } else if (uiScreens.length > 0) {
    warningsZh.push('UI 界面缺少 ASCII 字符框线图与 9-slice 九宫格 PSD 图层拆分规范。')
    warningsEn.push('UI screens are missing ASCII wireframes and 9-slice PSD layer specs.')
  }

  const pollutedTailIdx = detectPollutedLegacyRpgTailStart(txt)
  if (pollutedTailIdx !== null) {
    score = Math.max(5, score - 10)
    warningsZh.push(
      '检测到文档末尾存在旧版误追加的默认战斗/短剧数值与境界界面模板，点击下方按钮可一键清理还原。'
    )
    warningsEn.push(
      'Detected duplicate default RPG/short-drama template sections appended at the end of the document; click below to clean up.'
    )
  }

  return {
    overallScore: txt ? Math.min(100, Math.max(5, score)) : 0,
    sectionChecks,
    featureCount,
    hasPriorityTags,
    hasEdgeCaseHandling,
    hasNumericalFormulaBinding,
    uiScreens,
    warningsZh,
    warningsEn
  }
}

/**
 * 生成一个标准可被 `ui.split` 解析的单界面 Markdown 模块，供策划案工作台一键插入
 */
export function buildStandardUiScreenMarkdownBlock(scr: GameSystemUiScreenSpec, index = 1): string {
  return [
    `## 4.${index} ${scr.titleZh}（\`${scr.id}\`）`,
    `- **界面规格**：界面形态 \`screenKind: ${scr.screenKind}\` · 建议画幅比例 \`aspectRatio: ${scr.aspectRatio}\``,
    `- **绑定数值指标**：${scr.boundMetrics.map((m) => `\`${m}\``).join('、')}`,
    `- **界面结构（ASCII 字符框线布局草图）**：`,
    '```text',
    scr.wireframeAscii,
    '```',
    `- **区域划分**：`,
    ...scr.regionsZh.map((r) => `  - ${r}`),
    `- **控件清单与 7 状态规范（默认 / 悬停 / 按下 / 禁用 / 加载 / 空态 / 错误）**：`,
    ...scr.controlsZh.map((c) => `  - ${c}`),
    `- **PSD 图层拆分与九宫格（9-slice）规范**：`,
    `  - ${scr.psdLayersZh}`
  ].join('\n')
}

export interface AutoCompleteGameSystemResult {
  text: string
  fixedItemsZh: string[]
  fixedItemsEn: string[]
  changed: boolean
}

function insertBlockAtPosition(doc: string, pos: number, block: string): string {
  const before = doc.slice(0, pos).trimEnd()
  const after = doc.slice(pos).trimStart()
  if (!before) return after ? `${block.trim()}\n\n${after}` : block.trim()
  if (!after) return `${before}\n\n${block.trim()}`
  return `${before}\n\n${block.trim()}\n\n${after}`
}

/**
 * 一键补全策划案 6 维工程完备度缺失项（覆盖全部 6 大标准章节、P0/P1 与异常边界、乘区公式与配置表、多屏 UI 清单、ASCII 框线与 9-slice PSD 规范）。
 */
export function autoCompleteGameSystemDocument(
  docText: string,
  opts: SynthesizeGameSystemDocOptions
): AutoCompleteGameSystemResult {
  const rawTrimmed = (docText ?? '').trim()
  const fullRef = synthesizeGameSystemDocOffline(opts)
  if (!rawTrimmed) {
    return {
      text: fullRef,
      fixedItemsZh: ['完整 6 大标准章节策划案'],
      fixedItemsEn: ['Full 6-section GDD'],
      changed: true
    }
  }

  const arch =
    opts.archetype ??
    (opts.archetypeId && isGameSystemArchetypeId(opts.archetypeId)
      ? resolveGameSystemArchetype(opts.archetypeId)
      : resolveGameSystemArchetype(
          inferGameSystemArchetypeFromContext({
            prompt: `${opts.customInstruction ?? opts.instruction ?? ''} ${rawTrimmed}`
          })
        ))
  const targetAspect = opts.targetAspect ?? arch.defaultScreens[0]?.aspectRatio ?? '16:9'

  const getRefSection = (key: GddSectionKey): string => {
    const sp = findGddSectionSpan(fullRef, key)
    return sp ? fullRef.slice(sp.start, sp.end).trim() : ''
  }
  const getRefSectionBody = (key: GddSectionKey): string => {
    const sp = findGddSectionSpan(fullRef, key)
    return sp ? fullRef.slice(sp.headingEnd, sp.end).trim() : ''
  }

  let next = rawTrimmed
  const fixedItemsZh: string[] = []
  const fixedItemsEn: string[] = []

  // 0. 清理旧版误追加的默认 RPG 境界突破界面与短剧宿敌数值表冗余尾部
  const pollutedTailIdx = detectPollutedLegacyRpgTailStart(next)
  if (pollutedTailIdx !== null) {
    next = next.slice(0, pollutedTailIdx).trim()
    fixedItemsZh.push('清理末尾误追加的战斗/短剧默认模板')
    fixedItemsEn.push('Cleaned up duplicate RPG/short-drama boilerplate tail')
  }

  // 1. # 系统概述
  if (!findGddSectionSpan(next, 'overview')) {
    const sec = getRefSection('overview')
    if (sec) {
      next = `${sec}\n\n${next}`
      fixedItemsZh.push('# 系统概述')
      fixedItemsEn.push('# System Overview')
    }
  }

  // 2. # 系统目标
  if (!findGddSectionSpan(next, 'goals')) {
    const sec = getRefSection('goals')
    if (sec) {
      const ov = findGddSectionSpan(next, 'overview')
      next = insertBlockAtPosition(next, ov ? ov.end : 0, sec)
      fixedItemsZh.push('# 系统目标')
      fixedItemsEn.push('# System Goals')
    }
  }

  // 3. # 功能点设计 + P0/P1/P2 优先级 + 断线/连点/资源不足异常边界
  {
    const featSpan = findGddSectionSpan(next, 'features')
    const curAudit = auditGameSystemDocument(next)
    if (!featSpan) {
      const sec = getRefSection('features')
      if (sec) {
        const anchor = findGddSectionSpan(next, 'goals') ?? findGddSectionSpan(next, 'overview')
        next = insertBlockAtPosition(next, anchor ? anchor.end : next.length, sec)
        fixedItemsZh.push('# 功能点设计（含 P0/P1 与异常边界）')
        fixedItemsEn.push('# Feature Design (P0/P1 & edge cases)')
      }
    } else if (!curAudit.hasPriorityTags || !curAudit.hasEdgeCaseHandling) {
      const body = getRefSectionBody('features')
      if (body) {
        next = insertBlockAtPosition(next, featSpan.end, body)
        fixedItemsZh.push('功能点 P0/P1/P2 优先级与异常边界规则')
        fixedItemsEn.push('P0/P1/P2 priorities & edge-case rules')
      }
    }
  }

  // 4. # UI 布局设计 + 多界面 (>=2屏) + ASCII 框线图与 9-slice PSD 规范
  {
    const uiSpan = findGddSectionSpan(next, 'uiLayout')
    if (!uiSpan) {
      const sec = getRefSection('uiLayout')
      if (sec) {
        const anchor =
          findGddSectionSpan(next, 'features') ??
          findGddSectionSpan(next, 'goals') ??
          findGddSectionSpan(next, 'overview')
        next = insertBlockAtPosition(next, anchor ? anchor.end : next.length, sec)
        fixedItemsZh.push('# UI 布局设计（含多屏 ASCII 框线与 9-slice 规范）')
        fixedItemsEn.push('# UI Layout Design (multi-screen wireframes & 9-slice specs)')
      }
    } else {
      // 4a. 为已有但缺少 ASCII 框线图或 9-slice PSD 规范的子界面补齐缺失字段
      const curAudit = auditGameSystemDocument(next)
      if (curAudit.uiScreens.some((s) => !s.hasWireframe || !s.hasPsdSpec)) {
        const freshSpan = findGddSectionSpan(next, 'uiLayout')!
        const headerLine = next.slice(freshSpan.start, freshSpan.headingEnd)
        const rawUiBody = next.slice(freshSpan.headingEnd, freshSpan.end)
        let scrCursor = 0
        const patchedUiBody = rawUiBody.replace(
          /((?:^|\n)##+\s*(?:4\.\d+\s*)?([^\n]+)\n)([\s\S]*?)(?=\n##+\s+|\n#\s+|$)/g,
          (fullMatch, headingPart: string, rawHeading: string, blockBody: string) => {
            if (isGlobalUiPreambleSubheading(rawHeading.trim(), blockBody.trim())) {
              return fullMatch
            }
            const fallbackScr =
              arch.defaultScreens[scrCursor % arch.defaultScreens.length] ?? arch.defaultScreens[0]
            scrCursor += 1
            const asciiMatch =
              /```(?:text|ascii)?\s*\n([\s\S]*?)```/.exec(blockBody) ||
              /(\+[\-+]+\+[\s\S]*?\+[\-+]+\+)/.exec(blockBody)
            const wfSnippet = asciiMatch?.[1]?.trim() ?? ''
            const hasWf = wfSnippet.length > 20 || /[+┌┐└┘├┤┬┴┼─│]/.test(blockBody)
            const hasPsd =
              /9-slice|九宫格|PSD|01_Header|02_Interactive|03_Panels|图层拆分|分层输出|独立分层|分别成组|分别输出|单独输出/i.test(
                blockBody
              )
            const additions: string[] = []
            if (!hasWf && fallbackScr) {
              additions.push(
                `- **界面规格**：界面形态 \`screenKind: ${fallbackScr.screenKind}\` · 建议画幅比例 \`aspectRatio: ${targetAspect}\``,
                `- **界面结构（ASCII 字符框线布局草图）**：`,
                '```text',
                fallbackScr.wireframeAscii,
                '```'
              )
            }
            if (!hasPsd) {
              additions.push(
                `- **PSD 图层拆分与九宫格（9-slice）规范**：`,
                `  - ${fallbackScr?.psdLayersZh ?? '01_Header_Ornaments（顶栏标题与角标） / 02_Interactive_Controls（交互按钮七态独立组件） / 03_Panels_Containers（面板底框采用 9-slice 九宫格切边，四角不拉伸） / 04_Backdrop（底层背景独立分层）'}`
              )
            }
            if (!additions.length) return fullMatch
            return `${headingPart}${blockBody.trimEnd()}\n${additions.join('\n')}\n`
          }
        )
        if (patchedUiBody !== rawUiBody) {
          next = `${next.slice(0, freshSpan.start)}${headerLine}${patchedUiBody}${next.slice(freshSpan.end)}`
          fixedItemsZh.push('UI 界面 ASCII 框线图与 9-slice PSD 规范')
          fixedItemsEn.push('UI screen ASCII wireframes & 9-slice PSD specs')
        }
      }

      // 4b. 若界面数量仍不足 2 屏，追加原型标准界面直至 >= 2 屏
      const afterScreenAudit = auditGameSystemDocument(next)
      if (afterScreenAudit.uiScreens.length < 2) {
        const needed = Math.max(2 - afterScreenAudit.uiScreens.length, 1)
        const startIdx = afterScreenAudit.uiScreens.length + 1
        const extraBlocks = arch.defaultScreens
          .slice(0, Math.max(needed, 2))
          .map((scr, i) =>
            buildStandardUiScreenMarkdownBlock({ ...scr, aspectRatio: targetAspect }, startIdx + i)
          )
          .join('\n\n')
        const latestUiSpan = findGddSectionSpan(next, 'uiLayout')!
        next = insertBlockAtPosition(next, latestUiSpan.end, extraBlocks)
        fixedItemsZh.push('多界面 UI 拆分清单 (>=2屏)')
        fixedItemsEn.push('Multi-screen UI layout specs (>=2 screens)')
      }
    }
  }

  // 5. # UI 要求
  if (!findGddSectionSpan(next, 'uiRequirements')) {
    const sec = getRefSection('uiRequirements')
    if (sec) {
      const uiSpan = findGddSectionSpan(next, 'uiLayout')
      next = insertBlockAtPosition(next, uiSpan ? uiSpan.end : next.length, sec)
      fixedItemsZh.push('# UI 要求')
      fixedItemsEn.push('# UI Requirements')
    }
  }

  // 6. # 数据与配置 + 经济系统乘区公式与配置表绑定
  {
    const dcSpan = findGddSectionSpan(next, 'dataConfig')
    const curAudit = auditGameSystemDocument(next)
    if (!dcSpan) {
      const sec = getRefSection('dataConfig')
      if (sec) {
        const uiReqSpan = findGddSectionSpan(next, 'uiRequirements')
        next = insertBlockAtPosition(next, uiReqSpan ? uiReqSpan.end : next.length, sec)
        fixedItemsZh.push('# 数据与配置（含乘区公式与配置表）')
        fixedItemsEn.push('# Data & Configuration (formulas & tables)')
      }
    } else if (!curAudit.hasNumericalFormulaBinding) {
      const body = getRefSectionBody('dataConfig')
      if (body) {
        next = insertBlockAtPosition(next, dcSpan.end, body)
        fixedItemsZh.push('经济系统乘区公式与属性表绑定')
        fixedItemsEn.push('Economy multiplier formula & stat table binding')
      }
    }
  }

  return {
    text: next.trim(),
    fixedItemsZh,
    fixedItemsEn,
    changed: next.trim() !== rawTrimmed
  }
}

// ───────────────────────────── 策划案专属业务/教学数值配表引擎 ─────────────────────────────

/**
 * 判断节点标题、提示词或关联策划案是否属于非战斗业务/教学/实训/仿真场景（如中医药沉浸式虚拟教学系统）。
 */
export function isNonCombatDomainContext(text: string): boolean {
  const s = (text ?? '').trim()
  if (!s) return false
  if (
    /杀戮尖塔|炉石传说|阴阳师|小丑牌|幸存者|逆袭爽剧|打脸底牌|slay_the_spire|hearthstone|onmyoji|balatro|brotato/i.test(
      s
    )
  ) {
    return false
  }
  return /中医|经络|穴位|腧穴|药材|饮片|针灸|配伍|十八反|十九畏|教学|教育|实训|题库|测验|评分标准|数字孪生|展厅|展馆|博物馆|医疗|临床|解剖|科普|虚拟仿真|虚拟空间|导览|课件|培训|tcm|acupoint|meridian|simulation|education|training|digital.?twin/i.test(
    s
  )
}

export function isTcmTeachingDomain(text: string): boolean {
  return /中医|经络|穴位|腧穴|药材|饮片|针灸|配伍|十八反|十九畏|本草|脉诊|辨证|tcm|acupoint|meridian/i.test(
    text ?? ''
  )
}

function splitMdRowCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim().replace(/^`|`$/g, ''))
}

function isMdTableSeparator(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return false
  const cells = splitMdRowCells(trimmed)
  return cells.length >= 2 && cells.every((c) => /^:?-{2,}:?$/.test(c))
}

/**
 * 从系统策划案 Markdown 正文中自动提取所有业务表格（优先提取「数据与配置」「系统目标/关键验收项」中的表格），
 * 转换为可在数值系统工作台直接查看、搜索、编辑与导出的结构化 `MxDomainDataTable`。
 */
export function extractMarkdownTablesFromGdd(gddText: string): MxDomainDataTable[] {
  const src = (gddText ?? '').replace(/\r\n/g, '\n')
  if (!src.trim()) return []
  const lines = src.split('\n')
  const extracted: MxDomainDataTable[] = []

  let h2Title = ''
  let h3Title = ''
  let h4Title = ''
  let i = 0

  while (i < lines.length) {
    const line = (lines[i] ?? '').trim()
    if (line.startsWith('```')) {
      i++
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) i++
      i++
      continue
    }
    const hMatch = /^(#{1,4})\s+(.+)$/.exec(line)
    if (hMatch) {
      const lv = hMatch[1]!.length
      const txt = hMatch[2]!.trim()
      if (lv <= 2) {
        h2Title = txt
        h3Title = ''
        h4Title = ''
      } else if (lv === 3) {
        h3Title = txt
        h4Title = ''
      } else {
        h4Title = txt
      }
      i++
      continue
    }

    if (line.includes('|') && i + 1 < lines.length && isMdTableSeparator(lines[i + 1] ?? '')) {
      const headers = splitMdRowCells(line)
      i += 2
      const rawRows: string[][] = []
      while (i < lines.length) {
        const rLine = (lines[i] ?? '').trim()
        if (!rLine || !rLine.includes('|') || /^(#{1,4})\s+/.test(rLine)) break
        if (!isMdTableSeparator(rLine)) {
          rawRows.push(splitMdRowCells(rLine))
        }
        i++
      }
      if (headers.length >= 2 && rawRows.length >= 1) {
        const columns: MxDomainTableColumn[] = headers.map((hdr, cIdx) => ({
          key: `col_${cIdx + 1}`,
          label: hdr || `列${cIdx + 1}`,
          kind: 'text'
        }))
        const rows = rawRows.map((cells) => {
          const obj: Record<string, string | number> = {}
          columns.forEach((col, cIdx) => {
            const rawVal = cells[cIdx] ?? ''
            const asNum = Number(rawVal)
            obj[col.key] =
              rawVal !== '' && /^-?\d+(?:\.\d+)?$/.test(rawVal) && Number.isFinite(asNum)
                ? asNum
                : rawVal
          })
          return obj
        })
        const leafHeading = h4Title || h3Title || h2Title || `策划案表格 ${extracted.length + 1}`
        const category = h2Title || '策划案提取表'
        extracted.push({
          id: `gdd_tbl_${extracted.length + 1}`,
          title: leafHeading,
          category,
          description:
            h2Title && leafHeading !== h2Title
              ? `提取自策划案「${h2Title} / ${leafHeading}」`
              : `提取自策划案「${leafHeading}」`,
          columns,
          rows
        })
      }
      continue
    }
    i++
  }

  return extracted
}

function createTcmTeachingNumericalSuite(
  customTitle?: string,
  gddText?: string
): MxDomainNumericalSuite {
  const cleanTitle =
    customTitle?.trim() && !/数值系统$/.test(customTitle.trim())
      ? `${customTitle.trim()} · 策划案专属数值配表`
      : customTitle?.trim() || '中医药沉浸式虚拟教学系统 · 策划案专属数值配表'

  const formulas: MxDomainFormulaRule[] = [
    {
      id: 'f_total_score',
      name: '实训与理论综合成绩结算公式',
      expression:
        'TotalScore = round(AcupointScore * 0.40 + HerbScore * 0.25 + QuizScore * 0.25 + SafetyScore * 0.10, 1)',
      threshold: '合格 >= 80.0 分 · 优秀 >= 90.0 分 · 触碰安全红线直接判 0 分',
      description:
        '融合三维取穴实操、饮片性状鉴别、知识题库作答与医疗安全禁忌红线四维权重结算，交卷接口幂等一致。'
    },
    {
      id: 'f_acupoint_hit',
      name: '三维人体腧穴定位单点判分公式',
      expression:
        'PointScore = (dist_mm <= tol_perfect_mm ? 100 : dist_mm <= tol_pass_mm ? 75 : 0) * max(0.30, 1 - hint_level * 0.25)',
      threshold: '满分容差 <= 5mm · 合格容差 <= 10mm · 分级提示每级折减 25%',
      description:
        '基于当前绑定模型版本的表面锚点测地距离（mm）与法向夹角判定，未校准设备提示重校准。'
    },
    {
      id: 'f_interaction_sla',
      name: '本地沉浸交互与实时渲染性能红线',
      expression:
        'LocalFeedback_P99 <= 50ms && RayDropErr_2m_P95 <= 20mm && FrameTime_60Hz_P95 <= 14ms (90Hz <= 9ms)',
      threshold: '核心操作采样 >= 1000 次 · 连续运行 240 分钟无崩溃与显存持续增长',
      description:
        '严格区分本地首个可见反馈延迟（<=50ms）与云端模型流式推理耗时，禁止以按钮加载态冒充完整问答响应。'
    },
    {
      id: 'f_voice_barge_in',
      name: '数字人多轮问答、语音打断与字幕同步指标',
      expression:
        'BargeInStop_P95 <= 200ms && FirstText_P95 <= 3000ms && FirstAudio_P95 <= 4000ms && SubtitleSkew_P95 <= 150ms',
      threshold: '中医术语 ASR 识别率 >= 95% · 打断召回率/精确率 >= 90%',
      description: '客户端按 turn_id 与 sequence 过滤已取消或迟到语音分片，杜绝串会话与旧音频重播。'
    }
  ]

  const coreTables: MxDomainDataTable[] = [
    {
      id: 'tcm_runtime_params',
      title: '关键可配置参数与交互性能阈值表（runtime_config）',
      category: '系统性能与交互参数',
      description:
        '严格对应策划案「数据与配置 · 关键可配置参数」及「系统目标 · 关键验收项」，现场验收前冻结。',
      formulaHint: 'LocalFeedback_P99 <= 50ms · PinchDebounce = 250ms · FrameTime_60Hz_P95 <= 14ms',
      columns: [
        { key: 'param_key', label: '参数键名', kind: 'text' },
        { key: 'param_name', label: '配置项名称', kind: 'text' },
        { key: 'default_val', label: '默认值', kind: 'number' },
        { key: 'unit', label: '单位', kind: 'text' },
        { key: 'valid_range', label: '允许范围 / 验收阈值', kind: 'range' },
        { key: 'module', label: '归属子系统', kind: 'text' },
        { key: 'rule', label: '校验与冻结规则', kind: 'text' }
      ],
      rows: [
        {
          param_key: 'local_feedback_p99_ms',
          param_name: '本地交互反馈阈值',
          default_val: 50,
          unit: 'ms',
          valid_range: 'P99 <= 50 (采样>=1000次)',
          module: '交互输入',
          rule: '禁止后台放宽阈值后仍声称达标'
        },
        {
          param_key: 'pinch_debounce_ms',
          param_name: '捏合防重复窗口',
          default_val: 250,
          unit: 'ms',
          valid_range: '100 ~ 600',
          module: '手势识别',
          rule: '同命令去重，防止双触发'
        },
        {
          param_key: 'hand_lost_cancel_ms',
          param_name: '手部丢失取消时间',
          default_val: 300,
          unit: 'ms',
          valid_range: '100 ~ 1000',
          module: '手势识别',
          rule: '丢手超阈值回退预览态不误提交'
        },
        {
          param_key: 'dwell_confirm_ms',
          param_name: '射线驻留确认时间',
          default_val: 800,
          unit: 'ms',
          valid_range: '400 ~ 2000',
          module: '射线交互',
          rule: '无捏合辅助确认窗口'
        },
        {
          param_key: 'palm_open_hold_ms',
          param_name: '自定义菜单张掌保持',
          default_val: 400,
          unit: 'ms',
          valid_range: '300 ~ 1000',
          module: '手势识别',
          rule: '保存映射前检查作用域冲突'
        },
        {
          param_key: 'ray_angle_err_p95_deg',
          param_name: '射线静态角度误差上限',
          default_val: 0.5,
          unit: 'deg',
          valid_range: 'P95 <= 0.5° (2m落点<=20mm)',
          module: '设备校准',
          rule: '静态指向10秒漂移超限主动提示重校准'
        },
        {
          param_key: 'vad_endpoint_silence_ms',
          param_name: 'VAD 端点静音判定',
          default_val: 600,
          unit: 'ms',
          valid_range: '300 ~ 1200',
          module: '语音问答',
          rule: '需配套安静与噪声场景 ASR 测试'
        },
        {
          param_key: 'single_voice_max_s',
          param_name: '单次语音输入上限',
          default_val: 60,
          unit: 's',
          valid_range: '10 ~ 60',
          module: '语音问答',
          rule: '超限自动分段，不截断已识别文本'
        },
        {
          param_key: 'barge_in_buffer_ms',
          param_name: '语音打断预录缓冲',
          default_val: 500,
          unit: 'ms',
          valid_range: '200 ~ 800 (停播P95<=200ms)',
          module: '语音打断',
          rule: '仅内存循环保留，默认不落盘原始录音'
        },
        {
          param_key: 'first_text_timeout_s',
          param_name: '首段有效文本超时',
          default_val: 10,
          unit: 's',
          valid_range: '常态P95<=3s / 超时10s',
          module: '模型网关',
          rule: '超时进入明确错误态并提供重试与取消'
        },
        {
          param_key: 'total_gen_timeout_s',
          param_name: '单轮总生成超时',
          default_val: 60,
          unit: 's',
          valid_range: '15 ~ 60',
          module: '模型网关',
          rule: '服务端网关强制执行，支持幂等取消'
        },
        {
          param_key: 'subtitle_sync_p95_ms',
          param_name: '句级字幕与语音偏差',
          default_val: 150,
          unit: 'ms',
          valid_range: 'P95 <= 150 (文本一致率100%)',
          module: '数字人播报',
          rule: '读听同步，严禁口播与屏幕文本不一致'
        },
        {
          param_key: 'gpu_frametime_60hz_ms',
          param_name: '60Hz 基准 GPU 帧时间',
          default_val: 14,
          unit: 'ms',
          valid_range: '60Hz<=14ms / 90Hz<=9ms',
          module: '3D实时渲染',
          rule: '连续30分钟呈现间隔P99<=2周期，无>100ms停顿'
        },
        {
          param_key: 'idle_guide_prompt_min',
          param_name: '空闲引导提示时间',
          default_val: 10,
          unit: 'min',
          valid_range: '3 ~ 30',
          module: '会话生命周期',
          rule: '访客展厅模式与课堂实训模式可分档配置'
        },
        {
          param_key: 'history_retention_days',
          param_name: '常规学习记录保留期',
          default_val: 90,
          unit: '天',
          valid_range: '30 ~ 365 (本地日志<=1GB)',
          module: '合规与审计',
          rule: '敏感字段脱敏，支持按用户授权删除'
        }
      ]
    },
    {
      id: 'tcm_acupoint_rules',
      title: '十二正经核心腧穴三维定位与取穴实训容差配表（acupoint_training_rule）',
      category: '经络与腧穴实训',
      description:
        '对应策划案 F09/F10 及业务表 meridian / acupoint / acupoint_training_rule，定义三维取穴距离容差、安全针深与扣分阶梯。',
      formulaHint:
        'PointScore = (dist_mm <= tol_perfect_mm ? 100 : dist_mm <= tol_pass_mm ? 75 : 0) * (1 - hint_level * 0.25)',
      columns: [
        { key: 'point_code', label: '国际代码', kind: 'text' },
        { key: 'point_name', label: '穴位名称', kind: 'text' },
        { key: 'meridian', label: '归属经络', kind: 'text' },
        { key: 'tol_perfect_mm', label: '满分容差(mm)', kind: 'number' },
        { key: 'tol_pass_mm', label: '合格容差(mm)', kind: 'number' },
        { key: 'safe_depth_mm', label: '安全深度上限(mm)', kind: 'number' },
        { key: 'time_limit_s', label: '单点限时(s)', kind: 'number' },
        { key: 'score_weight', label: '标准分值', kind: 'number' },
        { key: 'safety_note', label: '解剖定位标志与安全禁忌红线', kind: 'text' }
      ],
      rows: [
        {
          point_code: 'LU7',
          point_name: '列缺',
          meridian: '手太阴肺经',
          tol_perfect_mm: 4.5,
          tol_pass_mm: 9.0,
          safe_depth_mm: 12,
          time_limit_s: 30,
          score_weight: 10,
          safety_note: '桡骨茎突上方腕横纹上1.5寸；避开桡动脉浅支，宜向上斜刺'
        },
        {
          point_code: 'LI4',
          point_name: '合谷',
          meridian: '手阳明大肠经',
          tol_perfect_mm: 5.0,
          tol_pass_mm: 10.0,
          safe_depth_mm: 20,
          time_limit_s: 25,
          score_weight: 10,
          safety_note: '第2掌骨桡侧中点处；【高危红线】孕妇严禁针刺'
        },
        {
          point_code: 'ST36',
          point_name: '足三里',
          meridian: '足阳明胃经',
          tol_perfect_mm: 5.5,
          tol_pass_mm: 11.0,
          safe_depth_mm: 30,
          time_limit_s: 25,
          score_weight: 10,
          safety_note: '犊鼻下3寸，胫骨前嵴外1横指；常规直刺'
        },
        {
          point_code: 'SP6',
          point_name: '三阴交',
          meridian: '足太阴脾经',
          tol_perfect_mm: 5.0,
          tol_pass_mm: 9.5,
          safe_depth_mm: 25,
          time_limit_s: 30,
          score_weight: 10,
          safety_note: '内踝尖上3寸胫骨内侧缘后际；【高危红线】孕妇严禁针刺'
        },
        {
          point_code: 'HT7',
          point_name: '神门',
          meridian: '手少阴心经',
          tol_perfect_mm: 4.0,
          tol_pass_mm: 8.0,
          safe_depth_mm: 10,
          time_limit_s: 30,
          score_weight: 10,
          safety_note: '腕掌侧远端横纹尺侧端，尺侧腕屈肌腱桡侧；避开尺动静脉'
        },
        {
          point_code: 'BL23',
          point_name: '肾俞',
          meridian: '足太阳膀胱经',
          tol_perfect_mm: 5.5,
          tol_pass_mm: 10.5,
          safe_depth_mm: 22,
          time_limit_s: 30,
          score_weight: 10,
          safety_note: '第2腰椎棘突下旁开1.5寸；严禁向内深刺伤及肾脏'
        },
        {
          point_code: 'KI3',
          point_name: '太溪',
          meridian: '足少阴肾经',
          tol_perfect_mm: 4.5,
          tol_pass_mm: 9.0,
          safe_depth_mm: 15,
          time_limit_s: 30,
          score_weight: 10,
          safety_note: '内踝高点与跟腱后缘连线中点凹陷；避开胫后动脉'
        },
        {
          point_code: 'PC6',
          point_name: '内关',
          meridian: '手厥阴心包经',
          tol_perfect_mm: 4.5,
          tol_pass_mm: 9.0,
          safe_depth_mm: 18,
          time_limit_s: 25,
          score_weight: 10,
          safety_note: '腕掌侧远端横纹上2寸两筋之间；忌深刺重提插损伤正中神经'
        },
        {
          point_code: 'GB20',
          point_name: '风池',
          meridian: '足少阳胆经',
          tol_perfect_mm: 4.5,
          tol_pass_mm: 8.5,
          safe_depth_mm: 20,
          time_limit_s: 35,
          score_weight: 12,
          safety_note:
            '枕骨之下胸锁乳突肌与斜方肌上端凹陷；【高危红线】针尖微下向鼻尖，严禁向对侧眼眶深刺延髓'
        },
        {
          point_code: 'LR3',
          point_name: '太冲',
          meridian: '足厥阴肝经',
          tol_perfect_mm: 4.5,
          tol_pass_mm: 9.0,
          safe_depth_mm: 15,
          time_limit_s: 25,
          score_weight: 10,
          safety_note: '足背第1、2跖骨结合部前方凹陷；避开足背动脉'
        },
        {
          point_code: 'GV20',
          point_name: '百会',
          meridian: '督脉',
          tol_perfect_mm: 5.0,
          tol_pass_mm: 9.5,
          safe_depth_mm: 12,
          time_limit_s: 25,
          score_weight: 10,
          safety_note: '前发际正中直上5寸或两耳尖连线中点；平刺为主，小儿囟门未闭禁针'
        },
        {
          point_code: 'CV4',
          point_name: '关元',
          meridian: '任脉',
          tol_perfect_mm: 5.0,
          tol_pass_mm: 10.0,
          safe_depth_mm: 25,
          time_limit_s: 25,
          score_weight: 10,
          safety_note: '脐中下3寸前正中线上；针前须排空膀胱，孕妇慎用/禁深刺'
        }
      ]
    },
    {
      id: 'tcm_herb_catalog',
      title: '中药饮片三维鉴别、剂量区间与配伍禁忌权重表（herb_entry）',
      category: '中药材三维图鉴',
      description:
        '对应策划案 F11 及业务表 herb_entry，规范标准名、药用部位、四气五味归经、药典常规剂量及十八反/十九畏安全拦截权重。',
      formulaHint:
        'HerbScore = TraitMatchPct * 0.70 + MeridianMatchPct * 0.30（触发十八反高危配伍直接拦截并扣满安全分）',
      columns: [
        { key: 'herb_id', label: '药材ID', kind: 'text' },
        { key: 'standard_name', label: '标准名称', kind: 'text' },
        { key: 'part', label: '药用部位', kind: 'text' },
        { key: 'nature_flavor', label: '四气五味', kind: 'text' },
        { key: 'meridians', label: '归经', kind: 'text' },
        { key: 'min_dose_g', label: '药典下限(g)', kind: 'number' },
        { key: 'max_dose_g', label: '药典上限(g)', kind: 'number' },
        { key: 'safety_tier', label: '安全等级', kind: 'enum' },
        {
          key: 'key_features_cautions',
          label: '三维性状鉴别考点与配伍禁忌（十八反/十九畏）',
          kind: 'text'
        }
      ],
      rows: [
        {
          herb_id: 'HB_001',
          standard_name: '人参',
          part: '干燥根及根茎',
          nature_flavor: '微温 · 甘、微苦',
          meridians: '脾、肺、心、肾',
          min_dose_g: 3,
          max_dose_g: 9,
          safety_tier: '十九畏警示',
          key_features_cautions:
            '芦头芦碗、珍珠点、皮细腻；【配伍禁忌】不宜与藜芦（十八反）、五灵脂（十九畏）同用'
        },
        {
          herb_id: 'HB_002',
          standard_name: '黄芪',
          part: '干燥根',
          nature_flavor: '微温 · 甘',
          meridians: '脾、肺',
          min_dose_g: 9,
          max_dose_g: 30,
          safety_tier: '常规教学',
          key_features_cautions:
            '断面纤维性强呈毛状、菊花心、嚼之微甜带豆腥味；表实邪盛气滞湿阻慎用'
        },
        {
          herb_id: 'HB_003',
          standard_name: '当归',
          part: '干燥根',
          nature_flavor: '温 · 甘、辛',
          meridians: '肝、心、脾',
          min_dose_g: 6,
          max_dose_g: 12,
          safety_tier: '常规教学',
          key_features_cautions:
            '归头止血、归身补血、归尾破血，断面黄白有棕色油点，香气浓郁；湿盛中满大便溏泄慎服'
        },
        {
          herb_id: 'HB_004',
          standard_name: '甘草',
          part: '干燥根及根茎',
          nature_flavor: '平 · 甘',
          meridians: '心、肺、脾、胃',
          min_dose_g: 2,
          max_dose_g: 10,
          safety_tier: '十八反红线',
          key_features_cautions:
            '断面纤维性黄白色、形成层环明显、放射状菊花心；【高危红线】反甘遂、京大戟、海藻、芫花'
        },
        {
          herb_id: 'HB_005',
          standard_name: '制附子（黑顺片）',
          part: '子根加工品',
          nature_flavor: '大热 · 辛、甘（有毒）',
          meridians: '心、肾、脾',
          min_dose_g: 3,
          max_dose_g: 15,
          safety_tier: '十八反红线',
          key_features_cautions:
            '纵切片外皮黑褐色、半透明角质样；【高危红线】须先煎30~60min；反半夏、瓜蒌、贝母、白蔹、白及；孕妇禁用'
        },
        {
          herb_id: 'HB_006',
          standard_name: '法半夏',
          part: '干燥块茎炮制品',
          nature_flavor: '温 · 辛',
          meridians: '脾、胃、肺',
          min_dose_g: 3,
          max_dose_g: 9,
          safety_tier: '十八反红线',
          key_features_cautions:
            '类球形顶端有凹陷茎痕，周围密布麻点根痕；【高危红线】反川乌、草乌、附子'
        },
        {
          herb_id: 'HB_007',
          standard_name: '川贝母（松贝）',
          part: '干燥鳞茎',
          nature_flavor: '微寒 · 苦、甘',
          meridians: '肺、心',
          min_dose_g: 3,
          max_dose_g: 10,
          safety_tier: '十八反红线',
          key_features_cautions:
            '外层鳞叶2瓣大小悬殊“怀中抱月”，顶端闭合底部平；【高危红线】反川乌、制川乌、草乌、附子'
        },
        {
          herb_id: 'HB_008',
          standard_name: '黄连（味连）',
          part: '干燥根茎',
          nature_flavor: '寒 · 苦',
          meridians: '心、脾、胃、肝、胆、大肠',
          min_dose_g: 2,
          max_dose_g: 5,
          safety_tier: '常规教学',
          key_features_cautions:
            '多分支聚集成簇形如鸡爪、中段有“过桥”、皮部橙红木部鲜黄；大苦大寒脾胃虚寒慎用'
        },
        {
          herb_id: 'HB_009',
          standard_name: '茯苓',
          part: '干燥菌核',
          nature_flavor: '平 · 甘、淡',
          meridians: '心、肺、脾、肾',
          min_dose_g: 10,
          max_dose_g: 15,
          safety_tier: '常规教学',
          key_features_cautions: '白色或淡红色块片，断面颗粒性有裂隙，无臭味淡嚼之粘牙'
        },
        {
          herb_id: 'HB_010',
          standard_name: '金银花',
          part: '干燥花蕾或带初开的花',
          nature_flavor: '寒 · 甘',
          meridians: '肺、心、胃',
          min_dose_g: 6,
          max_dose_g: 15,
          safety_tier: '常规教学',
          key_features_cautions:
            '棒状上粗下细略弯曲，表面黄白密被短柔毛，气清香；脾胃虚寒及气虚疮疡脓清者慎用'
        }
      ]
    },
    {
      id: 'tcm_exam_quota',
      title: '首版题库配比与实训测评计分权重表（question & exam_attempt）',
      category: '题库与测评计分',
      description:
        '对应策划案 F12 及业务表 question / exam_attempt，明确首版 100 题题库分布、标准试卷抽题量、分值权重与幂等判分规则。',
      formulaHint: 'PaperTotal = 100 分（限时 45 分钟，合格线 80 分，优秀线 90 分）',
      columns: [
        { key: 'q_type_id', label: '题型编码', kind: 'text' },
        { key: 'q_type_name', label: '考核题型与实训环节', kind: 'text' },
        { key: 'bank_total', label: '首版题库储备量(题)', kind: 'number' },
        { key: 'paper_count', label: '单卷抽题数(题)', kind: 'number' },
        { key: 'unit_score', label: '单题分值(分)', kind: 'number' },
        { key: 'subtotal_score', label: '分值小计(分)', kind: 'number' },
        { key: 'weight_pct', label: '总评权重(%)', kind: 'number' },
        { key: 'scoring_rule', label: '自动判分与边界规则', kind: 'text' }
      ],
      rows: [
        {
          q_type_id: 'QT_ACU_3D',
          q_type_name: '三维人体模型交互取穴实操',
          bank_total: 30,
          paper_count: 4,
          unit_score: 10,
          subtotal_score: 40,
          weight_pct: 40,
          scoring_rule: '按表面锚点容差半径(<=5mm满分/<=10mm得75%)×提示折减系数自动计分'
        },
        {
          q_type_id: 'QT_HERB_3D',
          q_type_name: '中药饮片三维外观性状与归经鉴别',
          bank_total: 25,
          paper_count: 5,
          unit_score: 5,
          subtotal_score: 25,
          weight_pct: 25,
          scoring_rule: '部位+典型性状特征(怀中抱月/鸡爪过桥/菊花心)+归经多维匹配计分'
        },
        {
          q_type_id: 'QT_MERIDIAN_MC',
          q_type_name: '十二正经循行走向与主治知识题',
          bank_total: 30,
          paper_count: 10,
          unit_score: 2.5,
          subtotal_score: 25,
          weight_pct: 25,
          scoring_rule: '单选全对得分；多选漏选得50%、错选得0分；试卷发布生成不可变快照'
        },
        {
          q_type_id: 'QT_SAFETY_RED',
          q_type_name: '针刺解剖危险区与十八反安全红线',
          bank_total: 15,
          paper_count: 5,
          unit_score: 2,
          subtotal_score: 10,
          weight_pct: 10,
          scoring_rule:
            '【安全红线】风池深刺延髓、孕妇合谷/三阴交、乌头反半夏等错判触发强告警与安全否决'
        }
      ]
    },
    {
      id: 'tcm_data_schema',
      title: '策划案核心业务数据表字典与约束总表（18张核心实体表）',
      category: '数据库与接口契约',
      description:
        '严格同步策划案「数据与配置 · 1. 核心业务数据表」，用于前后端模型网关、三维资产与教务归档表结构对齐。',
      columns: [
        { key: 'table_name', label: '表 / 对象名', kind: 'text' },
        { key: 'key_fields', label: '关键字段清单', kind: 'text' },
        { key: 'domain_group', label: '业务域', kind: 'text' },
        { key: 'constraint_rule', label: '强约束与校验规则', kind: 'text' }
      ],
      rows: [
        {
          table_name: 'user_profile',
          key_fields: 'user_id, role, organization_id, consent_flags',
          domain_group: '用户与权限',
          constraint_rule: '角色权限一律由服务端判定，客户端仅控制展示'
        },
        {
          table_name: 'learning_session',
          key_fields: 'session_id, user_id, device_id, course_id, config_version',
          domain_group: '会话与记录',
          constraint_rule: '会话结束后状态不可回退为进行中'
        },
        {
          table_name: 'scene_config',
          key_fields: 'scene_id, asset_bundle, spawn_point, quality_profile',
          domain_group: '3D场景与资产',
          constraint_rule: '资源包与场景配置版本强制配套校验'
        },
        {
          table_name: 'meridian',
          key_fields: 'meridian_id, name, path_asset, source_id, version',
          domain_group: '经络与腧穴',
          constraint_rule: '经络ID永久稳定，禁止随模型重导变更'
        },
        {
          table_name: 'acupoint',
          key_fields:
            'point_id, code, name, meridian_id, model_version, surface_anchor, normal, source_id',
          domain_group: '经络与腧穴',
          constraint_rule: '三维坐标与法线必须强绑定唯一解剖模型版本'
        },
        {
          table_name: 'acupoint_training_rule',
          key_fields: 'point_id, region_asset, distance_method, tolerance, hint_levels',
          domain_group: '经络与腧穴',
          constraint_rule: '容差半径与分级提示扣分需经中医专家审核冻结'
        },
        {
          table_name: 'herb_entry',
          key_fields: 'herb_id, standard_name, aliases, category, source, part, features, cautions',
          domain_group: '中药材图鉴',
          constraint_rule: '药典标准名与地方别名分开存储检索'
        },
        {
          table_name: 'teaching_content',
          key_fields: 'content_id, type, body, citation_ids, review_status, version',
          domain_group: '知识库与审核',
          constraint_rule: '未通过专家审核发布的内容对学员端不可见'
        },
        {
          table_name: 'question',
          key_fields: 'question_id, type, stem, options, answer, score, knowledge_tags, version',
          domain_group: '题库与考核',
          constraint_rule: '发布后形成不可变版本快照，修改须升版'
        },
        {
          table_name: 'exam_attempt',
          key_fields: 'attempt_id, paper_snapshot, started_at, deadline_at, answers, status, score',
          domain_group: '题库与考核',
          constraint_rule: 'POST /exam-attempts/{id}/submit 交卷幂等，查询与提交结果一致'
        },
        {
          table_name: 'dialogue_turn',
          key_fields: 'turn_id, session_id, question, answer, citations, model_version, status',
          domain_group: '多模态问答',
          constraint_rule: '完整覆盖完成、取消、语音打断、超时失败四态'
        },
        {
          table_name: 'speech_segment',
          key_fields: 'segment_id, turn_id, text, audio_ref, timing, emotion',
          domain_group: '多模态问答',
          constraint_rule: '临时语音分片按保留策略自动过期清理'
        },
        {
          table_name: 'avatar_action',
          key_fields: 'action_id, clip_ref, body_mask, priority, interrupt_window',
          domain_group: '数字人表现',
          constraint_rule: '动作切片与语义事件解耦，风险提示禁止娱乐化动作'
        },
        {
          table_name: 'gesture_binding',
          key_fields: 'profile_id, gesture_id, scope, command, thresholds',
          domain_group: '设备与输入',
          constraint_rule: '保存自定义手势映射前强制检查同作用域冲突'
        },
        {
          table_name: 'device_profile',
          key_fields: 'device_id, calibration_version, handedness, tracking_bounds',
          domain_group: '设备与输入',
          constraint_rule: '校准矩阵不可跨非兼容硬件设备直接复用'
        },
        {
          table_name: 'model_service',
          key_fields: 'service_id, provider, model_id, endpoint, secret_ref, capabilities, status',
          domain_group: '多模型网关',
          constraint_rule: '严禁将明文 API 密钥下发或存储在客户端'
        },
        {
          table_name: 'model_route',
          key_fields: 'scene_type, default_service, allowed_services, fallback_policy',
          domain_group: '多模型网关',
          constraint_rule: '前端仅读取已授权路由列表，至少联通4款商用大模型'
        },
        {
          table_name: 'audit_log',
          key_fields: 'actor, action, target, before_hash, after_hash, time',
          domain_group: '安全与运维',
          constraint_rule: '配置发布、回滚与记录删除全量留痕，敏感字段脱敏'
        }
      ]
    }
  ]

  // 若关联策划案中包含定量验收指标、手势识别阈值或计分规则表（且不与上述 5 张核心表重复），精选并入配表工作台，过滤纯文字权限/风险/交付清单表
  const extraGddTables = extractMarkdownTablesFromGdd(gddText ?? '').filter(
    (gt) =>
      !/核心业务数据表|关键可配置参数|角色|权限|系统边界|情绪|交付|问题|待确认|风险|接口|路由/.test(
        gt.title
      ) &&
      /验收|指标|阈值|手势|指令|容差|分值|配比|延迟|帧率|参数/.test(gt.title) &&
      gt.rows.length >= 3
  )

  return {
    enabled: true,
    domainId: 'tcm_virtual_teaching',
    title: cleanTitle,
    summary:
      '面向《中医药沉浸式虚拟交互教学系统》策划案的纯净工程数值与业务配表体系（零小说经济/零战斗卡牌污染）：涵盖本地50ms交互与帧率阈值、十二正经腧穴定位容差、中药饮片性状与十八反红线、100题实训测评计分权重及18张核心业务数据字典。',
    formulas,
    tables: [...coreTables, ...extraGddTables]
  }
}

/**
 * 根据节点标题、指令提示词或关联策划案全文，构建纯净的「策划案专属业务/教学数值配表套件」。
 */
export function buildDomainNumericalSuiteFromContext(opts: {
  title?: string
  prompt?: string
  gddText?: string
}): MxDomainNumericalSuite {
  const combined = `${opts.title ?? ''}\n${opts.prompt ?? ''}\n${(opts.gddText ?? '').slice(0, 3000)}`
  if (isTcmTeachingDomain(combined)) {
    return createTcmTeachingNumericalSuite(opts.title, opts.gddText)
  }

  const parsedTables = extractMarkdownTablesFromGdd(opts.gddText ?? '')
  const baseTitle = opts.title?.trim() || '系统策划案 · 专属业务参数与测评数值配表'

  const defaultTables: MxDomainDataTable[] = [
    {
      id: 'domain_runtime_sla',
      title: '交互响应与系统运行性能阈值表（runtime_sla）',
      category: '系统性能参数',
      description: '定义前端交互防抖、响应延迟、接口超时与渲染帧率红线。',
      columns: [
        { key: 'param_key', label: '参数键名', kind: 'text' },
        { key: 'param_name', label: '参数说明', kind: 'text' },
        { key: 'default_val', label: '默认值', kind: 'number' },
        { key: 'unit', label: '单位', kind: 'text' },
        { key: 'valid_range', label: '允许范围 / 验收标准', kind: 'range' }
      ],
      rows: [
        {
          param_key: 'local_feedback_p95_ms',
          param_name: '本地交互反馈延迟',
          default_val: 50,
          unit: 'ms',
          valid_range: 'P95 <= 50ms'
        },
        {
          param_key: 'click_debounce_ms',
          param_name: '重复点击防抖窗口',
          default_val: 300,
          unit: 'ms',
          valid_range: '150 ~ 500ms'
        },
        {
          param_key: 'api_timeout_ms',
          param_name: '业务接口请求超时',
          default_val: 8000,
          unit: 'ms',
          valid_range: '3000 ~ 15000ms'
        },
        {
          param_key: 'max_retry_count',
          param_name: '异常自动重试上限',
          default_val: 2,
          unit: '次',
          valid_range: '0 ~ 3次'
        },
        {
          param_key: 'target_fps',
          param_name: '基准运行帧率',
          default_val: 60,
          unit: 'fps',
          valid_range: '>= 60fps'
        }
      ]
    },
    {
      id: 'domain_eval_scoring',
      title: '核心任务与实训考核计分权重表（scoring_rules）',
      category: '业务计分规则',
      description: '定义各业务模块的分值配比、容错扣分规则与达标阈值。',
      columns: [
        { key: 'item_id', label: '指标编码', kind: 'text' },
        { key: 'item_name', label: '考核维度', kind: 'text' },
        { key: 'full_score', label: '满分分值', kind: 'number' },
        { key: 'weight_pct', label: '权重(%)', kind: 'number' },
        { key: 'pass_rule', label: '判定与扣分规则', kind: 'text' }
      ],
      rows: [
        {
          item_id: 'EVAL_CORE_01',
          item_name: '核心实操准确性',
          full_score: 50,
          weight_pct: 50,
          pass_rule: '按标准步骤与空间容差自动计算准确率'
        },
        {
          item_id: 'EVAL_THEORY_02',
          item_name: '专业知识题库测验',
          full_score: 30,
          weight_pct: 30,
          pass_rule: '发布快照判分，交卷幂等'
        },
        {
          item_id: 'EVAL_NORM_03',
          item_name: '操作规范与安全红线',
          full_score: 20,
          weight_pct: 20,
          pass_rule: '违背高危安全红线触发即时告警并一票否决'
        }
      ]
    }
  ]

  return {
    enabled: true,
    domainId: 'custom_gdd_tables',
    title: baseTitle,
    summary:
      '根据关联系统策划案生成的专属业务参数、验收阈值与测评计分数值表（不含无关小说或战斗数值）。',
    formulas: [
      {
        id: 'f_domain_score',
        name: '综合测评结算公式',
        expression: 'TotalScore = Σ(itemWeight_i * accuracy_i)',
        threshold: '满分 100 · 达标线 >= 80.0',
        description: '所有考核记录按 attempt_id 幂等归档，查询与提交结果严格一致。'
      },
      {
        id: 'f_domain_latency',
        name: '交互反馈与稳定性阈值',
        expression: 'LocalFeedback_P95 <= 50ms && DebounceWindow = 300ms',
        threshold: '核心任务独立完成率 >= 90%',
        description: '所有异步操作均具备加载态、超时重试态与可取消入口。'
      }
    ],
    tables: parsedTables.length > 0 ? [...defaultTables, ...parsedTables] : defaultTables
  }
}

/**
 * 将 `MxDomainNumericalSuite` 导出为下游 `asset.gameSystem` 可直接嵌入「# 数据与配置」的完整 Markdown 规格。
 */
export function exportDomainNumericalSuiteMarkdown(suite: MxDomainNumericalSuite): string {
  const lines: string[] = [
    `## 📋 【上游数值系统（game.numerical）➔ 系统策划案专属数值表与验收公式】`,
    `- **数值体系名称**：${suite.title}`,
    `- **适用说明**：${suite.summary}`,
    ``,
    `### 核心计分与性能验收公式`
  ]

  for (const f of suite.formulas) {
    lines.push(
      `- **${f.name}**：\`${f.expression}\`（标准阈值：${f.threshold}）—— ${f.description}`
    )
  }

  for (const tbl of suite.tables) {
    lines.push(``, `### ${tbl.title}`)
    if (tbl.description) {
      lines.push(`> ${tbl.description}`)
    }
    const headers = tbl.columns.map((c) => c.label).join(' | ')
    const sep = tbl.columns.map(() => '---').join(' | ')
    lines.push(`| ${headers} |`, `| ${sep} |`)
    for (const r of tbl.rows) {
      const cells = tbl.columns
        .map((c) =>
          String(r[c.key] ?? '')
            .replace(/\|/g, '\\|')
            .replace(/\r?\n/g, ' ')
        )
        .join(' | ')
      lines.push(`| ${cells} |`)
    }
  }

  return lines.join('\n')
}

/**
 * 将单张 `MxDomainDataTable` 导出为带 UTF-8 BOM 的标准 CSV 文本（Excel 可直接无乱码打开）。
 */
export function exportDomainTableCsv(table: MxDomainDataTable): string {
  const esc = (val: string | number | undefined): string => {
    const s = String(val ?? '')
    if (/[",\r\n]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }
  const headerLine = table.columns.map((c) => esc(c.label)).join(',')
  const bodyLines = table.rows.map((r) => table.columns.map((c) => esc(r[c.key])).join(','))
  return `\uFEFF${[headerLine, ...bodyLines].join('\r\n')}`
}
