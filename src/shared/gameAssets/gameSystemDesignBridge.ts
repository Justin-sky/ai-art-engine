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
  runMxCombatKernelSimulation,
  runMxLootAndSubstatSimulation,
  runMxRoguelikeEnvelopeSimulation,
  solveMxSingleTurnLethalAndOrderSkill,
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
  labelZh: '通用全套游戏系统与 UI 总纲',
  labelEn: 'Universal Full-Stack Game System & UI Suite',
  icon: '🎮',
  linkedNovelGenres: ['custom_literary', 'urban_reversal', 'xianxia_cultivation'],
  linkedEconomyPresets: ['short_drama_reversal_loop', 'slay_the_spire_dbg', 'mmorpg_economy'],
  coreLoopZh:
    '主界面大厅与核心资源统筹 ➔ 角色/卡组/装备深度养成 ➔ 局内核心战斗与章节Boss挑战 ➔ 战利品抽卡结算与长线目标推进',
  coreLoopEn:
    'Lobby & resource management -> Character/deck build -> Core battle & Boss stage -> Loot settlement & progression',
  playerGoalZh: '清晰感知短期每局正反馈、中期阵容构筑成型与长期章节主线通关的三层目标闭环',
  designGoalZh:
    '输出覆盖大厅、养成、战斗 HUD、结算弹窗全链路的标准系统策划案与可一键拆分的 UI 界面矩阵',
  defaultFeatures: [
    ...ARCHETYPE_RPG.defaultFeatures.slice(0, 2),
    ...ARCHETYPE_GACHA_LOOT.defaultFeatures.slice(0, 1)
  ],
  defaultScreens: [
    ARCHETYPE_RPG.defaultScreens[0]!,
    ARCHETYPE_RPG.defaultScreens[1]!,
    ARCHETYPE_GACHA_LOOT.defaultScreens[0]!,
    ARCHETYPE_RPG.defaultScreens[2]!
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
}): GameSystemArchetypeId {
  const p =
    `${opts.prompt ?? ''} ${opts.novelGenre ?? ''} ${opts.economyPreset ?? ''}`.toLowerCase()
  if (/怪谈|理智|san值|克苏鲁|收容|rule_horror|lovecraft/.test(p)) return 'rule_horror_sanity'
  if (/悬疑|推理|搜证|刑侦|分支|影游|宫斗|avg|mystery|detective|romance/.test(p))
    return 'avg_mystery_branch'
  if (/权谋|朝堂|势力|内阁|外交|slg|historical_intrigue/.test(p)) return 'slg_faction_intrigue'
  if (/割草|幸存者|波次|尸潮|废土|survivor|scifi_apocalypse/.test(p)) return 'roguelike_survivor'
  if (/抽卡|卡池|保底|御魂|词条|gacha|onmyoji/.test(p)) return 'gacha_equipment_loot'
  if (/卡牌|构筑|牌库|杀戮尖塔|炉石|小丑牌|dbg|deck|slay_the_spire|balatro|hearthstone/.test(p))
    return 'card_dbg_combat'
  if (/全套|总纲|大厅|universal/.test(p)) return 'universal_full_ui'
  return 'rpg_progression'
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

  let roster: MxNovelCharacterStatusEntry[] = []
  if (opts.characterRosterJson?.trim()) {
    try {
      const parsed = JSON.parse(opts.characterRosterJson) as MxNovelCharacterStatusEntry[]
      if (Array.isArray(parsed)) roster = parsed
    } catch {
      roster = []
    }
  }
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

  let foreshadowings: MxNovelForeshadowingEntry[] = []
  if (opts.foreshadowingJson?.trim()) {
    try {
      const parsed = JSON.parse(opts.foreshadowingJson) as MxNovelForeshadowingEntry[]
      if (Array.isArray(parsed)) foreshadowings = parsed
    } catch {
      foreshadowings = []
    }
  }

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
  const wb = opts.wb ?? createMxWorkbenchPreset('short_drama_progression')
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

  const entityTableRows = wb.multiplier.entities
    .map((e) => {
      const statStr = Object.entries(e.stats)
        .map(([k, v]) => `${k}:${v}`)
        .join(' / ')
      return `| \`${e.id}\` | ${e.name} | ${e.rarity} | ${e.cost} | ${statStr} |`
    })
    .join('\n')

  const extraContextBlock =
    opts.novelIpSpec?.trim() ||
    (combinedIncoming ? `\n## 6.2 上游经济系统与小说 IP 联动数据契约\n${combinedIncoming}\n` : '')

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
  const sectionChecks = {
    overview: /#\s*系统概述|#\s*System Overview/i.test(txt),
    goals: /#\s*系统目标|#\s*System Goals/i.test(txt),
    features: /#\s*功能点设计|#\s*Feature Design/i.test(txt),
    uiLayout: /#\s*UI\s*布局设计|#\s*UI Layout Design/i.test(txt),
    uiRequirements: /#\s*UI\s*要求|#\s*UI Requirements/i.test(txt),
    dataConfig: /#\s*数据与配置|#\s*核心数值|#\s*Data\s*&\s*Configuration/i.test(txt)
  }

  const featureMatches = txt.match(/SYS-[A-Z0-9-]+|##\s*3\.\d+|功能编号/g) ?? []
  const featureCount = Math.max(
    featureMatches.length,
    (txt.match(/优先级[：:]\s*`?P[012]/g) ?? []).length
  )
  const hasPriorityTags = /\bP0\b|\bP1\b|\bP2\b/.test(txt)
  const hasEdgeCaseHandling = /边界与异常|异常处理|断线|超时|不足|溢出|防抖|Edge cases/i.test(txt)
  const hasNumericalFormulaBinding =
    /乘区|公式|保底|ATK|HP|的概率|期望|Formula|Multiplier|Pity/i.test(txt)

  // Extract UI Screens from `# UI 布局设计` section
  const uiScreens: GameSystemUiScreenPreviewItem[] = []
  const uiLayoutMatch = /#\s*(?:UI\s*布局设计|UI Layout Design)([\s\S]*?)(?=\n#\s+[^#]|$)/i.exec(
    txt
  )
  const uiBody = uiLayoutMatch?.[1] ?? txt

  const subHeadingRe = /##+\s*(?:4\.\d+\s*)?([^\n]+)\n([\s\S]*?)(?=\n##+\s+|\n#\s+|$)/g
  let m: RegExpExecArray | null
  let idx = 1
  while ((m = subHeadingRe.exec(uiBody)) !== null) {
    const rawHeading = m[1]!.trim()
    const block = m[2]!.trim()
    if (
      !uiLayoutMatch &&
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
    const hasPsdSpec = /9-slice|九宫格|PSD|01_Header|02_Interactive|03_Panels/i.test(block)

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

  const secCount = Object.values(sectionChecks).filter(Boolean).length
  score += Math.round((secCount / 6) * 30)
  if (secCount < 5) {
    warningsZh.push(
      `当前策划案仅包含 ${secCount}/6 个标准章节，建议补全缺失的「# 功能点设计 / # UI 布局设计 / # 数据与配置」章节。`
    )
    warningsEn.push(`Document has ${secCount}/6 standard GDD sections.`)
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
