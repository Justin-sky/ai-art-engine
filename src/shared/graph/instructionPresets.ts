/**
 * 生成指令预设：按用途分套（含图片反推提示词 / 提示词优化）。
 *
 * 剧本模板由「短剧提示词」原稿提炼而来，保留结构槽位与硬约束，去掉例文堆砌。
 */

export type InstructionPresetKind =
  | 'screenplay'
  | 'gameSystem'
  | 'image'
  | 'video'
  | 'lipSync'
  | 'reshoot'
  | 'voice'
  | 'toPrompt'
  | 'optimize'
  | 'spatialWorldExtract'
  | 'beatSplit'
  | 'beatUnitGen'
  | 'uiSplit'
  | 'frameAnimGen'
  | 'svgGen'
  | 'gameHtmlGen'
  | 'model3d'
  | 'spatialWorld'
  | 'modelPose'
  | 'modelRigSkin'
  | 'modelSegment'
  | 'modelMeshComplete'
  | 'modelRetopology'
  | 'modelRigCheck'
  | 'modelRetarget'
  | 'modelConvert'
  | 'modelTexture'
  | 'modelAnimation'
  | 'mediaReview'
  | 'mediaRework'

/** 预设页签（反推等跨行业模板用）；缺省不参与页签 UI */
export type InstructionPresetTab = 'general' | 'game' | 'film' | 'character' | 'fx'

import {
  EPISODE_AGENT_BEATBOARD,
  EPISODE_AGENT_BREAKDOWN,
  EPISODE_AGENT_DIRECTOR,
  EPISODE_AGENT_MOTION,
  EPISODE_AGENT_SEQUENCE,
  type EpisodeAgentPromptPack
} from './episodeAgentPrompts'
import { ANIM2D_PRESETS } from './anim2d'

export const INSTRUCTION_PRESET_TAB_ORDER: readonly InstructionPresetTab[] = [
  'character',
  'fx',
  'general',
  'game',
  'film'
] as const

export interface InstructionPreset {
  id: string
  /** i18n 标题 key */
  titleKey: string
  /** 写入生成指令框的正文 */
  body: string
  /** 可选页签；有多页签时菜单显示筛选 */
  tab?: InstructionPresetTab
  /** 可选；缺省时由 resolveInstructionVisual 推断 */
  visual?: import('./presetVisual').PresetVisual
}

export function insertInstructionPresetText(
  current: string,
  body: string,
  position: number
): { text: string; cursor: number } {
  const at = Math.max(0, Math.min(position, current.length))
  const before = current.slice(0, at)
  const after = current.slice(at)
  const prefix = before && !before.endsWith('\n') ? '\n' : ''
  const suffix = after && !after.startsWith('\n') ? '\n' : ''
  const inserted = `${prefix}${body}${suffix}`
  return {
    text: `${before}${inserted}${after}`,
    cursor: at + inserted.length
  }
}

/**
 * 短剧创作框架
 * 提取自原稿：题材 / 核心设定 / 人物 / 亮点 / 节奏规格 / 风格 / 交付物
 */
const SCREENPLAY_CREATE_BODY = `请按下列框架创作短剧剧本（先填空，再生成）。

【题材】从中选组合：穿越｜重生｜仙侠｜都市｜悬疑｜搞笑
【核心设定】一句话写清最独特的脑洞与冲突源
【人物】主角/对手/关键配角：身份 · 性格 · 能力 · 欲望
【剧情引擎】爽点 / 反转 / 热梗（至少各 1 项，服务注意力）
【风格】轻松搞笑｜紧张刺激｜悬疑惊悚｜热血逆袭（可组合）

【节奏规格】
- 单集约 1 分钟；约每 3 秒一小冲突，约每 15 秒一反转
- 开篇即进入冲突，禁止长铺垫；第 1 集必须交齐核心冲突与主爽点
- 每集结尾必须留悬念钩子

【交付】共 __ 集。每集输出：分镜编号｜画面描述｜角色台词｜镜头运动提示｜场景提示`

/** 增加爽点和反转 */
const SCREENPLAY_TWISTS_BODY = `请帮我优化下面这个短剧剧本，重点增加爽点和反转情节，让剧情更有冲击力。要求：
1. 在不改变原有主线剧情的基础上，增加 2-3 个意想不到的反转
2. 强化主角的高光时刻，让爽点更密集
3. 让后续的打脸场面更出彩
4. 保持原有的轻松搞笑风格

剧本内容：`

/** 优化台词 */
const SCREENPLAY_DIALOGUE_BODY = `请帮我优化下面这个短剧剧本的台词，要求：
1. 让台词更符合人物的性格特点
2. 增加一些网络热门梗和搞笑台词，让对话更有趣
3. 去掉啰嗦的台词，让语言更简洁有力
4. 保持原有的剧情不变

剧本内容：`

/** 强化结尾钩子 */
const SCREENPLAY_HOOKS_BODY = `请帮我优化下面这个短剧每一集的结尾钩子，要求：
1. 每个结尾都要留下足够的悬念，让观众忍不住想看下一集
2. 钩子要和下一集的内容紧密相关
3. 可以用反问句、感叹句或者预告式的结尾
4. 不要剧透下一集的全部内容

剧本内容：`

/**
 * 游戏系统策划案预设。
 *
 * 定位：本节点的下游是「UI 界面拆分 → UI 界面生成」，所以预设必须产出
 * **界面级**的策划案 —— 说清这个系统有哪些界面、每屏什么布局与控件，
 * 拆分层才拆得出可用的出图提示词；只写数值与规则的策划案在这里跑不通。
 *
 * 每条只负责「要做什么系统」，章节结构、控件状态、禁写配色等规范由节点的
 * 系统提示词统一负责，避免两处重复维护、日后改一处漏一处。
 */

/** 界面清单是这一段的重点：下游拆分层只认它 */
const GAME_SYSTEM_UI_REQUIREMENTS = `界面要求（下游要按这些界面拆图，必须写全）：
1. 先列「界面清单」：本系统一共几个界面 / 面板 / 弹窗，逐个起名，标明整屏还是弹窗
2. 每个界面单独一节，写清：
   - 界面类型：全屏页面 / 侧边面板 / 居中弹窗 / 底部抽屉 / 顶部条
   - 布局分区：从上到下、从左到右有哪些区，各自放什么，大致占比
   - 控件清单：按钮 / 列表 / 页签 / 图标格 / 进度条 / 数值文本 / 开关，逐个说明用途
   - 控件状态：默认 / 悬停 / 按下 / 选中 / 禁用 / 加载中 / 空态 / 错误态，该有的都要写
   - 界面之间的跳转：从哪进、点哪个控件出去
   - 空态与满态：一条数据都没有时显示什么，数据塞满时怎么滚动或分页
3. 需要展示的文案给出示例（标题、按钮字、提示语），别只写「显示提示」
4. 只描述布局、控件与状态；不要指定颜色、材质、光影、画风，视觉统一交给风格参考图`

/** 通用框架：给「想做个系统但还没想清」的人用 */
const GAME_SYSTEM_OUTLINE_BODY = `请为下列游戏系统出一份可用于开发与出图的系统策划案。

【系统名称】____
【一句话玩法】玩家在什么场景下、为了什么目标、重复做什么动作
【入口与出现时机】从哪进这个系统（主界面按钮 / 关卡结算 / 角色面板）
【与已有系统的关系】依赖谁、被谁依赖、共享哪些数值或资源
【目标平台】手机竖屏 / 手机横屏 / PC

${GAME_SYSTEM_UI_REQUIREMENTS}

功能要求：
1. 功能点逐个编号，每条写清触发入口、规则流程、结算条件与优先级（P0/P1/P2）
2. 边界与异常必须穷举：断线、超时、重复点击、资源不足、数值溢出、并发冲突
3. 每条功能给出可验证的验收标准，写不出验收标准的功能视为未定义清楚
4. 结尾单列「待确认项」与「风险」，把需要拍板的决策点列出来`

/** 背包与道具 */
const GAME_SYSTEM_INVENTORY_BODY = `请出一份「背包与道具系统」的游戏系统策划案，供后续拆分界面出图。

【游戏类型与题材】____
【道具分类】按用途分几类（消耗品 / 装备 / 材料 / 任务道具 / 皮肤……），各类图标样式差异
【容量与堆叠】背包格数、单格堆叠上限、扩容方式
【获取与消耗】道具从哪来（关卡掉落 / 商城 / 活动 / 合成）、用到哪去
【排序与筛选】玩家最常用的排序维度（品质 / 类型 / 获得时间 / 战力）

${GAME_SYSTEM_UI_REQUIREMENTS}

本系统的界面至少要覆盖（按实际玩法增删，但要写全）：
1. 背包主界面：格子网格、分类页签、排序筛选入口、容量提示、批量操作入口
2. 道具详情：弹窗还是侧栏，展示图标、名称、品质、描述、数量与可用操作（使用 / 装备 / 出售 / 分解）
3. 使用与批量使用：数量选择控件（滑条 / 加减 / 长按连续）与二次确认
4. 出售 / 分解：选择与确认、收益预览、不可出售项的禁用态
5. 排序与筛选面板：筛选维度、已选条件回显、重置
6. 道具对比：待比较道具的并列展示（属性逐行对比、提升 / 下降的增减标记）、
   对比对象从哪选（背包内长按、已装备项自动带出）、最多同时对比几件
7. 套装效果：套装件数进度（已集齐 / 缺哪件）、逐档套装属性预览、
   从套装跳转到缺失部件的获取途径
8. 图鉴 / 收集册：已获得与未获得的区分（剪影或占位）、收集进度统计、
   按分类与稀有度的浏览、点开看详情与来源说明
9. 强化 / 精炼 / 镶嵌等道具改造入口（若本系统承担改造）：作为独立界面还是详情页内页签
10. 空态、满态与超容量提示

数值要求：
1. 给出各类道具的堆叠上限、背包扩容阶梯与解锁条件
2. 说明道具的整体产出与消耗节奏，避免长期只进不出
3. 标明哪些数值可调、调整会影响哪些系统`

/** 主界面与 HUD */
const GAME_SYSTEM_MAINUI_BODY = `请出一份「主界面与 HUD」的游戏系统策划案，供后续拆分界面出图。

【游戏类型与题材】____
【目标平台与朝向】手机竖屏 / 手机横屏 / PC，安全区与刘海适配要求
【核心循环入口】玩家每次回到主界面最可能点的三个入口，按优先级排序
【常驻信息】玩家随时要看到的：等级、资源、体力、任务进度、活动倒计时等

${GAME_SYSTEM_UI_REQUIREMENTS}

本系统的界面至少要覆盖（按实际玩法增删，但要写全）：
1. 主界面：核心入口按钮区、常驻信息条（头像 / 等级 / 体力 / 货币）、活动与公告入口、
   任务与邮件红点、设置与菜单入口；说明哪些入口固定、哪些随进度解锁
2. 主界面弹窗层：公告、签到、活动预告、离线收益结算
3. 顶部 / 底部导航条：页签数量、当前页签选中态、未读与红点规则
4. 加载与重连态：加载进度、断线重连提示、资源更新提示
5. 首日新手 / 老玩家回流两种情况下主界面的差异（少了什么、多了什么）
6. 活动中心：活动列表与卡片（时间、奖励预览、进行中 / 即将开始 / 已结束三态）、
   活动详情页、奖励领取与条件未达成的置灰
7. 签到面板：日历网格、已签 / 今日可签 / 未到日期三态、连续签到奖励档位、补签入口
8. 公告与邮件：公告弹窗（标题、正文、不再提示、跳转）、
   邮件列表（未读 / 已读 / 附件未领 / 已过期）、邮件详情与一键领取附件
9. 设置面板：分组（基础 / 画面 / 音效 / 语言 / 账号 / 关于）、
   开关与滑条控件、需要二次确认的项（清缓存、退出登录、注销账号）
10. 离线收益结算：离线时长、收益逐项清单、双倍领取（看广告或付费）入口
11. 强提示类弹窗：强制更新、维护公告、封禁或风控告知

数值与规则要求：
1. 红点规则逐条写清：什么条件亮、什么条件灭、父级是否冒泡
2. 各入口的解锁条件与前置进度
3. 首屏加载需要哪些数据、缺数据时各区域的降级表现`

/** 升级与成长 */
const GAME_SYSTEM_LEVELUP_BODY = `请出一份「升级与成长系统」的游戏系统策划案，供后续拆分界面出图。

【成长对象】角色等级 / 账号等级 / 装备强化 / 技能树（可多选，逐个写）
【成长资源】经验、金币、突破材料等，各自的主要来源
【关键节点】满级、突破、转职等节点前后的变化
【付费影响】是否存在加速成长的道具，非付费玩家的追赶手段

${GAME_SYSTEM_UI_REQUIREMENTS}

本系统的界面至少要覆盖（按实际玩法增删，但要写全）：
1. 成长面板：当前等级、经验进度条、属性数值与增减对比、下一级预览
2. 升级操作：材料选择、数量选择、消耗预览、成功率（若有）、一键升级
3. 升级结果：成功反馈（数值变化对比）、动画与音效落点、材料不足的表现
4. 突破 / 转职：条件清单（逐条打勾或置灰）、材料来源跳转、确认弹窗
5. 技能树或天赋面板：节点连线、已解锁 / 可解锁 / 未解锁三态、重置与洗点
6. 技能详情：技能图标、等级、冷却与消耗、效果描述（数值随等级变化的对照）、
   升级该技能的材料与前置、传承 / 重置入口
7. 装备强化 / 精炼面板：槽位、当前等级与上限、消耗材料、成功率与保底、
   附魔或词条洗练的候选词条与替换选择
8. 星级 / 突破素材选择：素材列表（含未拥有的置灰与获取跳转）、批量投入、预览突破后形态
9. 成就与称号：进度条、已达成 / 未达成、领取按钮与已领取态、称号佩戴入口
10. 战力或综合评分总览：各养成途径的贡献占比、可提升项的跳转入口
11. 满级态与资源不足态

数值要求：
1. 给出升级 / 突破所需数值表（等级、所需经验或材料、累计值、相邻增幅）与曲线取法
2. 标明每级属性成长量，以及属性对战斗结果的影响口径
3. 给出 3 类玩家画像（休闲 / 主流 / 硬核）在同一系统下的预期进度差异
4. 列出可调参数与调参影响面`

/** 商城与内购 */
const GAME_SYSTEM_SHOP_BODY = `请出一份「商城与内购」的游戏系统策划案，供后续拆分界面出图。

【游戏类型与题材】____
【售卖品类】直购道具 / 礼包 / 月卡 / 通行证 / 限时折扣（按实际保留）
【货币体系】免费货币与付费货币各有几种、能不能互相兑换、兑换比例与每日上限
【定价档位】几个档位、各档位对应什么心理价位
【上架规则】是否分阶段解锁、是否按玩家进度展示不同商品

${GAME_SYSTEM_UI_REQUIREMENTS}

本系统的界面至少要覆盖（按实际玩法增删，但要写全）：
1. 商城主页：分类页签（推荐 / 道具 / 礼包 / 货币 / 时装）、推荐位轮播、商品网格或列表
2. 商品卡片：图标、名称、原价与现价、折扣角标、限购次数、剩余时间、售罄 / 已拥有 / 未解锁态
3. 商品详情：弹窗或独立页，展示内容物逐项清单、数量、有效期、赠送说明、购买按钮
4. 购买确认与支付：货币选择（付费 / 免费、是否可混合抵扣）、余额与不足提示、
   支付方式选择、未成年人或风控拦截提示
5. 支付结果：成功、失败、取消、掉单补发四种结果的表现与后续引导
6. 礼包与月卡：内容物预览、每日领取入口与红点、剩余天数
7. 限时与折扣：倒计时、折扣对比、过期后的置灰与下架
8. 兑换与礼包码入口（若玩法需要）
9. 余额不足、商品下架、重复购买三种异常态
10. 货币兑换：免费货币与付费货币的兑换方向、比例、每日上限与兑换余量回显
11. 时装 / 皮肤商店：试穿或预览、已拥有与未拥有的区分、套装成套购买与折扣
12. 通行证（若玩法有）：赛季进度条、免费档与付费档并列、逐级奖励预览、
    已领取 / 可领取 / 未解锁三态、一键领取
13. 购物车与批量结算（若支持多商品一起买）：已选清单、总价与优惠、逐项移除
14. 购买记录：时间、商品、金额、状态（成功 / 处理中 / 失败 / 已退款）与分页

数值与合规要求：
1. 逐条列出商品内容物与定价，标明每个商品的付费替代关系（不买能不能通过免费途径获得、要多久）
2. 写出限购规则：每日 / 每周 / 终身，以及刷新时间点
3. 支付与掉单的处理流程要写清：客户端表现、服务端判定、补发入口在哪
4. 列出需要展示的合规文案位置（价格单位、自动续费说明、概率说明等），但不要指定具体颜色与版式风格`

/** 充值流程 */
const GAME_SYSTEM_RECHARGE_BODY = `请出一份「充值流程」的游戏系统策划案，供后续拆分界面出图。

【目标平台与支付渠道】iOS 内购 / 安卓多渠道 / PC 官网 / 主机（按实际保留）
【货币名称】付费货币叫什么、与法币的换算关系、有无赠送档位
【首充与活动】是否首充双倍、有无累充与充值返利
【客服与申诉】掉单、误充、退款的用户自助入口在哪

${GAME_SYSTEM_UI_REQUIREMENTS}

本系统的界面至少要覆盖（按实际玩法增删，但要写全）：
1. 充值中心：档位网格（每档显示货币数量、赠送量、价格、首充标记）、当前余额、充值说明入口
2. 自定义金额：输入控件、快捷金额、可用范围与错误提示（低于最低 / 高于上限 / 非法字符）
3. 档位详情与确认：到账内容逐项、赠送条件（如首充双倍）、确认按钮与二次确认
4. 支付中与结果页：拉起支付渠道的过程态、成功到账反馈（余额变化动画落点）、
   失败与取消的分流引导、待支付订单的恢复入口
5. 掉单与补发：如何让用户自助找回，入口位置与处理中的状态展示
6. 充值记录：时间、档位、金额、状态（成功 / 处理中 / 失败 / 已退款）、分页
7. 客服与申诉入口：误充、退款、发票等入口的位置与前置条件
8. 风控与限额提示：单笔上限、单日上限、未成年限制、渠道不可用时的降级表现
9. 礼包码 / 兑换码输入：输入控件与键盘类型、成功到账反馈、已使用 / 已过期 / 无效三种错误态
10. 支付方式选择：可选渠道列表、默认选中项、渠道不可用时的置灰与说明
11. 自动续费（若有月卡 / 订阅）：开通确认、续费状态与下次扣费时间、
    取消续费入口与取消后的到期时间说明
12. 余额与账单明细：付费货币余额、获取与消耗流水、按时间筛选与分页

数值与规则要求：
1. 逐档列出：法币价格、获得付费货币、赠送量、折算单价，并说明档位阶梯的设计意图
2. 写出首充 / 累充 / 返利的触发条件、发放方式与展示位置
3. 支付状态机：从点击充值到最终到账的全部状态与各自的界面表现
4. 列出需要展示的合规文案位置（价格单位、自动续费说明、退款说明等），不要指定具体颜色与版式风格`

/** 自定义游戏系统 */
const GAME_SYSTEM_CUSTOM_BODY = `请为下列游戏系统出策划案，供后续拆分界面出图。

【系统名称】____
【核心玩法】玩家在这里做什么、重复什么动作、获得什么反馈
【入口与出现时机】____
【与其它系统的关系】____

${GAME_SYSTEM_UI_REQUIREMENTS}

补充要求：
1. 若本系统涉及数值，给出关键数值表与来源去向；纯交互类系统可跳过
2. 边界与异常穷举：断线、超时、重复点击、资源不足、并发冲突
3. 结尾单列「待确认项」与「风险」`

/** 与已有策划案对齐（收尾用） */
const GAME_SYSTEM_ALIGN_BODY = `请检查并补齐下面这份策划案与项目其余部分的一致性，不要推翻既有结论。

【待对齐的策划案】接在上方连线或本节点正文中
【本项目已确定的规范】世界观、术语表、UI 风格参考、已有系统的数值口径

要求：
1. 逐条找出与世界观、术语、数值口径冲突的地方，给出修改建议并说明理由
2. 补齐缺失章节：边界与异常、验收标准、待确认项与风险，缺哪补哪
3. 统一术语与命名：同一概念在全文只用一种叫法，并给出术语表
4. 标注哪些结论与上游系统耦合、改动会波及谁
5. 保持原有结构与编号，不重排、不改写已确认的结论`

const GAME_SYSTEM_PRESETS: InstructionPreset[] = [
  {
    id: 'gameSystem.outline',
    titleKey: 'graph.inspector.generate.presets.gameSystem.outline',
    body: GAME_SYSTEM_OUTLINE_BODY
  },
  {
    id: 'gameSystem.inventory',
    titleKey: 'graph.inspector.generate.presets.gameSystem.inventory',
    body: GAME_SYSTEM_INVENTORY_BODY
  },
  {
    id: 'gameSystem.mainUi',
    titleKey: 'graph.inspector.generate.presets.gameSystem.mainUi',
    body: GAME_SYSTEM_MAINUI_BODY
  },
  {
    id: 'gameSystem.levelUp',
    titleKey: 'graph.inspector.generate.presets.gameSystem.levelUp',
    body: GAME_SYSTEM_LEVELUP_BODY
  },
  {
    id: 'gameSystem.shop',
    titleKey: 'graph.inspector.generate.presets.gameSystem.shop',
    body: GAME_SYSTEM_SHOP_BODY
  },
  {
    id: 'gameSystem.recharge',
    titleKey: 'graph.inspector.generate.presets.gameSystem.recharge',
    body: GAME_SYSTEM_RECHARGE_BODY
  },
  {
    id: 'gameSystem.custom',
    titleKey: 'graph.inspector.generate.presets.gameSystem.custom',
    body: GAME_SYSTEM_CUSTOM_BODY
  },
  {
    id: 'gameSystem.align',
    titleKey: 'graph.inspector.generate.presets.gameSystem.align',
    body: GAME_SYSTEM_ALIGN_BODY
  }
]

const SCREENPLAY_PRESETS: InstructionPreset[] = [
  {
    id: 'screenplay.create',
    titleKey: 'graph.inspector.generate.presets.screenplay.create',
    body: SCREENPLAY_CREATE_BODY
  },
  {
    id: 'screenplay.twists',
    titleKey: 'graph.inspector.generate.presets.screenplay.twists',
    body: SCREENPLAY_TWISTS_BODY
  },
  {
    id: 'screenplay.dialogue',
    titleKey: 'graph.inspector.generate.presets.screenplay.dialogue',
    body: SCREENPLAY_DIALOGUE_BODY
  },
  {
    id: 'screenplay.hooks',
    titleKey: 'graph.inspector.generate.presets.screenplay.hooks',
    body: SCREENPLAY_HOOKS_BODY
  }
]

/** 人物设定提示词优化 */
const OPTIMIZE_CHARACTER_BODY = `你是一位专业的 AI 绘画提示词工程师，专门为AI工具生成人物设定图提示词。请严格按照以下格式生成提示词，不要添加任何多余的解释：

第一行（基础要求）：全身正面照，白色背景，A-pose（双臂张开45度），虚幻引擎UE5建模真人风格，高精度建模渲染，8K超清，电影质感，柔和光影，真实皮肤质感，无磨皮，禁止过度美颜，禁止塑料皮肤，轻微皮肤瑕疵，比例协调，无多余人物，无背景杂物
第二行（人物基础信息）：[年龄]岁，[性别]，[身份]
第三行（外貌特征）：[脸型]，[眼睛]，[鼻子]，[嘴巴]，[肤色]，[身材]，[其他特征]
第四行（服装造型）：穿着[朝代/风格]的[服装款式]，[主色调]，[材质]材质，[装饰细节]
第五行（发型妆容）：[发型描述]，[妆容描述]
第六行（神态气质）：[表情]，[整体气质]
第七行（限定词）：无水印，无文字，合规内容

现在请根据以下人物描述生成提示词：`

/** 道具提示词优化 */
const OPTIMIZE_PROP_BODY = `你是一位顶级的 AI 绘画提示词工程师，专门为AI工具生成道具提示词。请严格按照以下要求生成提示词：
1. 基础风格固定为：虚幻引擎UE5建模写实风格，高精度建模渲染，8K超清，电影质感，真实物理材质，PBR材质纹理，全局光照，光影写实
2. 每个道具都要详细描述：材质、颜色、形状、尺寸、装饰、磨损程度、特殊效果
3. 结尾必须包含：纯白色纯色背景，无任何其他元素，无阴影，无反光，无投影，正面视角，水平居中放置，完整展示
4. 语言简洁，不要有多余的解释，每个道具的提示词单独成段
5. 不要输出任何标题、序号或说明文字

现在，请你为我生成以下道具的提示词：`

/** 场景提示词优化（兼顾 Three.js 场景搭建可读性，不输出 JSON） */
const OPTIMIZE_SCENE_BODY = `你是一位专业的 AI 场景提示词工程师，熟悉短剧美术与 Three.js 实时场景搭建习惯。
请根据下列场景描述，只输出一段可直接用于生图的提示词（不要解释、不要输出 JSON）。
提示词需覆盖：
1. 风格与画质：按描述自洽；高精度、可读材质（可用 PBR 语感：粗糙度/金属度/透射等）；无人物、无文字、无水印
2. 基本信息：场景名称、时代背景、时间、天气、环境氛围
3. 空间布局：整体尺度、主要建筑/地貌、关键道具相对位置；地面水平、立面垂直、透视稳定（便于按图在 Three.js 中还原）
4. 材质与色彩：墙/地/金属/玻璃/织物等分区清楚，主色调与磨损细节
5. 光影：主光方向、环境光、阴影体积感；可选雾/体积光
6. 质量：透视正确，比例协调，细节丰富，光影统一

语言简洁，重点突出。现在请根据以下场景描述生成提示词：`

/** 运镜提示词优化 */
const OPTIMIZE_CAMERA_BODY = `你是一位专业的电影摄影师，拥有10年以上的影视拍摄经验。请根据我提供的运镜需求，生成一段详细、专业的运镜描述。要求：
1. 详细描述运镜的整个过程，包括开始位置、移动路径、结束位置
2. 明确说明运镜的速度和节奏，比如“缓慢匀速”、“先慢后快”、“急促”等
3. 描述运镜过程中画面的变化，比如焦点的变化、景别的变化
4. 同时明确机位角度、人物身体朝向和观众视角；需要真实感时加入轻微手持、停顿或跟随延迟，避免不可能的漂浮运镜
5. 区分静帧信息与运动信息：不要重复场景设定，重点写视频过程中发生的变化
6. 语言要简洁明了，适合作为 AI 视频生成的提示词；不要有多余的废话

现在请根据以下运镜需求生成描述：`

/** 人物表情提示词优化 */
const OPTIMIZE_EXPRESSION_BODY = `你是一位专业的影视表演指导。请把用户输入的抽象情绪或人物动作，改写成适合 AI 图片/视频生成的可观察表演提示词。
要求：
1. 禁止只写“生气、悲伤、疯癫、释然”等抽象词；必须拆解为眉眼、嘴唇、鼻翼、下颌、呼吸等具体面部动作
2. 加入肩颈、手指、躯干、重心等至少一处肢体反应
3. 视频场景要写出动作时序，例如“先疑惑皱眉，随后唇角紧抿”
4. 动作克制、符合生理规律；除非用户要求，不要夸张到面部变形
5. 只输出优化后的提示词，不解释方法

现在请优化以下人物表演：`

/** 特效提示词优化 */
const OPTIMIZE_VFX_BODY = `你是一位专业的影视特效师，擅长为 AI 短剧生成符合AI工具要求的特效提示词。请根据我提供的特效需求，生成一段详细、具体的特效描述，要求包含特效的颜色、形状、大小、位置、运动方式、光影效果，语言风格符合 AI 绘画提示词的规范，不要有多余的修饰。特效需求：`

/** 剧集 Agent 流水线：角色提示词整包作为生成指令（含角色设定与输出格式） */
function episodePresetBody(pack: EpisodeAgentPromptPack): string {
  return `${pack.systemPromptZh}\n\n${pack.instructionZh}`
}

/** 多机位九宫格 */
const IMAGE_MULTI_ANGLE_9_BODY = `基于当前参考图，生成一张「多机位九宫格」拼图。
要求：
1. 约 9 个不同机位/景别视角（如大特写、特写、半身、中景、全景、仰拍、俯拍、侧拍、过肩等），均匀排布为 3×3 九宫格
2. 保持同一主体、服装、气质与场景风格一致，仅改变机位、景别与构图
3. 支持并尽量发挥模型可用的图像分辨率能力，画面清晰、边缘整齐、无错位拼接感
4. 无边框、无白边、无缝拼接，每格独立成幅，无文字水印

请直接输出九宫格图像。`

/** 剧情推演四宫格 */
const IMAGE_STORY_4_BODY = `基于当前参考图，生成一张「剧情推演四宫格」拼图。
要求：
1. 2×2 四宫格，按时间顺序推演后续剧情（起→承→转→合）
2. 角色身份、服装与场景逻辑连贯，动作与情绪递进自然
3. 支持文生或参考图生成：有参考图时保持主体一致；可结合指令中的文本补充剧情
4. 无边框、无白边、无缝拼接，电影分镜感，无文字水印

请直接输出四宫格剧情推演图。`

/** 角色脸部三视图 */
const IMAGE_FACE_TURNAROUND_BODY = `基于当前参考图，生成「角色脸部三视图」。
要求：
1. 白底；含正面肖像特写，以及左侧面、右侧面（或 3/4 侧）脸部视图
2. 五官、发型、妆容与参考图一致，光照均匀，无遮挡
3. 支持通过文本/参考图约束外貌细节
4. 干净排版，适合作为角色脸部参考，无文字水印

请直接输出脸部三视图。`

/** 角色设定图 */
const IMAGE_CHARACTER_SHEET_BODY = `基于当前参考图，生成完整的「角色设定图」。
要求：
1. 包含全身/半身主视图、关键服装细节、配色与必要特写，信息完整可读
2. 保持角色身份、外形与气质一致；白底或简洁背景
3. 支持通过文本/参考图补充设定细节
4. 设定图排版清晰，无杂乱背景与文字水印

请直接输出角色设定图。`

/** 角色三视图 */
const IMAGE_CHARACTER_TURNAROUND_BODY = `基于当前参考图，生成「角色三视图」。
要求：
1. 白底；含正面、侧面、背面全身（或半身）三视图，并带正面肖像特写
2. 体型、服装、配饰与参考一致，比例准确，A-pose 或自然站姿
3. 支持通过文本/参考图生成与约束
4. 排版整齐，适合建模/动画参考，无文字水印

请直接输出角色三视图。`

/** 道具三视图 */
const IMAGE_PROP_TURNAROUND_BODY = `基于当前参考图/文本，生成「道具三视图」。
要求：
1. 纯白纯色背景；同一道具的正面、侧面、背面（或俯视）三视图并排，完整剪影可读
2. 造型、比例、材质、颜色、装饰与磨损与参考一致；可带一小幅细节特写（开关、铭牌、接缝等）
3. 无手、无人物、无场景环境；正面视角优先竖立/居中摆放，比例准确
4. 排版整齐，适合道具建模/绑定参考，无文字水印、无阴影杂乱

请直接输出道具三视图。`

/** 武器三视图 */
const IMAGE_WEAPON_TURNAROUND_BODY = `基于当前参考图/文本，生成「武器三视图」。
要求：
1. 纯白纯色背景；同一武器的正面、侧面、背面（或刀背/枪侧）三视图并排，刃口与结构清晰
2. 造型、比例、材质、护手/枪机/装饰与磨损与参考一致；可带一小幅细节特写（刃纹、准星、铭文纹理等）
3. 无手握持、无人物、无战斗场景；武器完整展示，比例准确
4. 排版整齐，适合武器建模/绑定参考，无文字水印、无阴影杂乱

请直接输出武器三视图。`

/** 场景设定图（兼顾 Three.js 重建可读性） */
const IMAGE_SCENE_SHEET_BODY = `基于当前参考图/文本，生成完整的「场景设定图」，并便于后续在 Three.js 中还原空间。
要求：
1. 交代空间结构、主视角、材质与氛围光影；可含局部细节特写或小幅多角度拼图
2. 与参考场景风格一致；尺度可读（门、窗、地面网格、家具等提供比例参照）
3. 布局清晰：主体建筑/房间轴线明确，前后景层次清楚，关键可互动物件位置可辨
4. 材质分区清楚（墙/地/金属/玻璃/织物等），主光方向稳定，阴影交代体积
5. 无多余人物干扰（除非场景需要），无文字水印、无 HUD
6. 构图避免极端畸变，优先稳定透视，方便按图搭建 Three.js 场景（地面水平、立面垂直）

请直接输出场景设定图。`

/** 产品设定图 */
const IMAGE_PRODUCT_SHEET_BODY = `基于当前参考图，生成完整的「产品设定图」。
要求：
1. 展示产品主视图、关键角度与材质/结构细节，信息完整
2. 保持产品造型、比例与风格一致；白底或简洁背景
3. 支持通过文本/参考图补充产品特征
4. 工业/设计设定图风格，干净清晰，无文字水印

请直接输出产品设定图。`

/** 25宫格连贯分镜 */
const IMAGE_STORY_25_BODY = `基于当前参考图，生成「25宫格连贯分镜」拼图。
要求：
1. 5×5 共 25 格，按时间顺序做连贯剧情推演，镜头节奏清晰
2. 角色与场景逻辑连续，景别与机位有变化，叙事可读
3. 支持文生或参考图生成：有参考图时保持主体一致
4. 分格整齐、可读性强，无文字水印

请直接输出 25 宫格连贯分镜图。`

/** 电影级光影校正 */
const IMAGE_CINEMATIC_LIGHTING_BODY = `基于当前参考图，进行「电影级光影校正」。
要求：
1. 按电影机光影逻辑重塑明暗、对比与氛围，保留主体与构图可识别性
2. 可微调景别/视角以增强电影感，但不改变核心内容与角色身份
3. 支持通过文本/参考图指定光影风格（如低调、高调、逆光、体积光等）
4. 质感细腻，无过度美颜与文字水印

请直接输出光影校正后的图像。`

/** 画面推演-3秒后 */
const IMAGE_PHYSICS_3S_LATER_BODY = `基于当前参考图，按物理与动作逻辑推演「约 3 秒后」的画面结果。
要求：
1. 根据当前姿态、受力、惯性与环境，合理推断 3 秒后的动作与空间关系
2. 保持角色/物体身份与场景一致，变化要可解释、符合物理直觉
3. 输出单张结果图，电影分镜质感，无文字水印

请直接输出 3 秒后的推演画面。`

/** 画面推演-5秒前 */
const IMAGE_PHYSICS_5S_BEFORE_BODY = `基于当前参考图，按物理与动作逻辑反推「约 5 秒前」的动作起因画面。
要求：
1. 根据当前结果姿态，合理反推导致此刻状态的前序动作与空间关系
2. 保持角色/物体身份与场景一致，因果关系清晰可信
3. 输出单张结果图，电影分镜质感，无文字水印

请直接输出 5 秒前的起因画面。`

/** 720 全景 */
const IMAGE_PANORAMA_720_BODY = `基于当前场景图像，生成「720 全景图」。
要求：
1. 将场景扩展/转换为可环视的 720° 全景（等距柱状 equirectangular / 全向环境贴图），空间连续、透视自然
2. 画幅比例必须为 2:1（宽:高）；优先 2048×1024 或 4096×2048 等 2:1 分辨率，便于 Three.js 全景球贴图
3. 保持原场景风格、材质与光影氛围一致，补全未见区域时需合理、可衔接
4. 支持文生或参考图生成：有参考图时以场景为主体；可结合文本补充环境细节
5. 输出适合全景浏览的单张全景图，无文字水印、无明显接缝撕裂、上下极点尽量少畸变

请直接输出 720 全景图（2:1）。`

/** 分镜思维：图负责定格空间、构图和光影，视频负责后续运动。 */
const IMAGE_SHOT_ESTABLISH_BODY = `生成一张可作为视频首帧的「建立镜头」。
【主体/场景】[填写主体、地点、时间与天气]
【构图】远景或航拍，明确前中后景与空间关系，保留叙事性负空间
【光影】写清主光来源、阴影落点与环境反射
【一致性】有参考图时保持角色、产品、服装和场景一致
只生成静态首帧，不在图片提示词中描述连续运镜；无文字、水印或 UI。`

const IMAGE_SHOT_DETAIL_BODY = `生成一张可作为视频首帧的「插入特写 / 动作细节镜头」。
【细节主体】[手部、眼睛、产品按钮、仪表、机械部件等]
【构图】特写或大特写，焦点明确，背景适度虚化；保留动作发生前一瞬的张力
【真实反馈】加入材质、微小磨损、反光、空气或环境痕迹，避免过度干净的 AI 质感
只定格关键瞬间，不描述完整动作过程；无文字、水印或 UI。`

const IMAGE_SHOT_CONFRONTATION_BODY = `生成一张可作为视频首帧的「低机位对峙镜头」。
【主体】[两个角色 / 两件产品 / 主体与环境威胁]
【构图】极低机位，中景或全景，双方形成明确的空间轴线与视觉张力
【光影】地面反射、轮廓光或高反差侧光强化冲突
【约束】主体身份、比例和场景逻辑稳定
只生成静态首帧；无文字、水印或 UI。`

/**
 * 风格迁移：优先用风格芯片，内容图连入口后再用指令栏「@」芯片引用；
 * 也可用两张连线参考（先内容后风格）。模板内勿写死 @n。
 */
const IMAGE_STYLE_TRANSFER_BODY = `【风格迁移】保留内容构图与主体，只换画风。

【用法（二选一）】
A. 推荐：把目标风格图加入本节点/工程「风格参考」（指令条「风格」芯片，强度建议 0.6–0.85）；把内容图连到图片输入口，并在下方用指令栏「@」芯片引用内容图 [内容图，可选]。
B. 备选：依次连接「内容图 → 风格图」两张参考，用指令栏「@」芯片依次指代 [内容图，可选] 与 [风格参考，可选]（未使用风格芯片时）。

【硬约束】
- 严格保留内容图的主体身份、姿态、构图与空间关系
- 只迁移风格参考的画风、色彩、笔触/材质与光影气质
- 禁止换人、大改构图、新增剧情元素；禁止字幕与水印

请输出一张完成风格迁移后的图像。`

const IMAGE_PRESETS: InstructionPreset[] = [
  {
    id: 'image.styleTransfer',
    titleKey: 'graph.inspector.generate.presets.image.styleTransfer',
    body: IMAGE_STYLE_TRANSFER_BODY
  },
  {
    id: 'image.multiAngle9',
    titleKey: 'graph.inspector.generate.presets.image.multiAngle9',
    body: IMAGE_MULTI_ANGLE_9_BODY
  },
  {
    id: 'image.story4',
    titleKey: 'graph.inspector.generate.presets.image.story4',
    body: IMAGE_STORY_4_BODY
  },
  {
    id: 'image.faceTurnaround',
    titleKey: 'graph.inspector.generate.presets.image.faceTurnaround',
    body: IMAGE_FACE_TURNAROUND_BODY
  },
  {
    id: 'image.characterSheet',
    titleKey: 'graph.inspector.generate.presets.image.characterSheet',
    body: IMAGE_CHARACTER_SHEET_BODY
  },
  {
    id: 'image.characterTurnaround',
    titleKey: 'graph.inspector.generate.presets.image.characterTurnaround',
    body: IMAGE_CHARACTER_TURNAROUND_BODY
  },
  {
    id: 'image.propTurnaround',
    titleKey: 'graph.inspector.generate.presets.image.propTurnaround',
    body: IMAGE_PROP_TURNAROUND_BODY
  },
  {
    id: 'image.weaponTurnaround',
    titleKey: 'graph.inspector.generate.presets.image.weaponTurnaround',
    body: IMAGE_WEAPON_TURNAROUND_BODY
  },
  {
    id: 'image.sceneSheet',
    titleKey: 'graph.inspector.generate.presets.image.sceneSheet',
    body: IMAGE_SCENE_SHEET_BODY
  },
  {
    id: 'image.productSheet',
    titleKey: 'graph.inspector.generate.presets.image.productSheet',
    body: IMAGE_PRODUCT_SHEET_BODY
  },
  {
    id: 'image.story25',
    titleKey: 'graph.inspector.generate.presets.image.story25',
    body: IMAGE_STORY_25_BODY
  },
  {
    id: 'image.cinematicLighting',
    titleKey: 'graph.inspector.generate.presets.image.cinematicLighting',
    body: IMAGE_CINEMATIC_LIGHTING_BODY
  },
  {
    id: 'image.physics3sLater',
    titleKey: 'graph.inspector.generate.presets.image.physics3sLater',
    body: IMAGE_PHYSICS_3S_LATER_BODY
  },
  {
    id: 'image.physics5sBefore',
    titleKey: 'graph.inspector.generate.presets.image.physics5sBefore',
    body: IMAGE_PHYSICS_5S_BEFORE_BODY
  },
  {
    id: 'image.panorama720',
    titleKey: 'graph.inspector.generate.presets.image.panorama720',
    body: IMAGE_PANORAMA_720_BODY
  },
  {
    id: 'image.shotEstablish',
    titleKey: 'graph.inspector.generate.presets.image.shotEstablish',
    body: IMAGE_SHOT_ESTABLISH_BODY
  },
  {
    id: 'image.shotDetail',
    titleKey: 'graph.inspector.generate.presets.image.shotDetail',
    body: IMAGE_SHOT_DETAIL_BODY
  },
  {
    id: 'image.shotConfrontation',
    titleKey: 'graph.inspector.generate.presets.image.shotConfrontation',
    body: IMAGE_SHOT_CONFRONTATION_BODY
  }
]

/**
 * 首尾帧万能模板。
 * 首/尾帧走专用端口（指令条「首帧/尾帧」芯片，不占 @）；
 * 方舟等模型：尾帧不可与参考图混用，本模板勿接参考图口 / 勿写 @n。
 */
const VIDEO_FIRST_LAST_FRAME_BODY = `请基于已连接的「首帧」「尾帧」生成过渡视频（首尾帧模式）。
须先在生成参数中选择「首尾帧」，并把图连到首帧/尾帧口；勿接参考图，勿用 @ 引用任何图片。

【风格】虚幻引擎 UE5 建模风格，高精度建模渲染，电影质感，8K 超清，光影写实，色彩自然
【一致】起止两帧中人物外观、服装、场景、道具与光影保持一致
【运镜】[在此描述运镜：推/拉/摇/移/环绕/升降/跟拍等]
【过程】运镜平滑流畅、速度均匀，无卡顿、无跳跃；人物姿势稳定，表情自然，无穿模、无变形
【音效】[可选：环境音、风声等，勿依赖参考图]
【禁项】无字幕，无水印，无多余元素`

const VIDEO_FL2V_PREFIX = `请基于已连接的「首帧」「尾帧」生成过渡视频（首尾帧模式；勿接参考图，勿写 @）。保持人物、场景、道具、光影一致。`

/** 推 / 拉镜头（可整段使用或拼入首尾帧模板运镜槽） */
const VIDEO_CAMERA_DOLLY_BODY = `${VIDEO_FL2V_PREFIX}任选其一运镜，或改写括号内容：

【推镜头】
镜头从首帧的[远景]，缓慢匀速向前推进，逐渐聚焦到[主体位置]，最终定格在尾帧的[特写]

【拉镜头】
镜头从首帧的[主体特写]，缓慢匀速向后拉远，逐渐展示整个场景，最终定格在尾帧的[全景]

运镜过程平滑流畅，速度均匀，无卡顿，无跳跃；人物姿势不变，表情自然，无穿模，无变形
无字幕，无水印，无多余元素`

/** 左右摇 / 上下摇 / 左右移 */
const VIDEO_CAMERA_PAN_TILT_BODY = `${VIDEO_FL2V_PREFIX}任选其一运镜：

【左右摇】
镜头从首帧的左侧视角，缓慢匀速向右摇动，扫过整个场景，最终定格在尾帧的右侧视角

【上下摇】
镜头从首帧的仰拍视角，缓慢匀速向下摇动，最终定格在尾帧的俯拍视角

【左右移】
镜头从首帧的画面左侧，缓慢匀速向右平移，保持与人物平行，最终定格在尾帧的画面右侧

运镜过程平滑流畅，速度均匀，无卡顿，无跳跃；人物姿势不变，表情自然，无穿模，无变形
无字幕，无水印，无多余元素`

/** 360° / 180° 环绕 */
const VIDEO_CAMERA_ORBIT_BODY = `${VIDEO_FL2V_PREFIX}任选其一运镜：

【360度环绕】
镜头围绕[主体]做360度缓慢匀速环绕运动，始终保持[主体]在画面正中央，最终回到起始位置；运镜过程中人物姿势不变，表情自然，场景光影随镜头角度自然变化

【180度环绕】
镜头从首帧的人物正面，围绕人物做180度缓慢匀速环绕运动，最终定格在尾帧的人物背面

运镜过程平滑流畅，速度均匀，无卡顿，无跳跃；无穿模，无变形
无字幕，无水印，无多余元素`

/** 升 / 降镜头 */
const VIDEO_CAMERA_CRANE_BODY = `${VIDEO_FL2V_PREFIX}任选其一运镜：

【升镜头】
镜头从首帧的地面视角，缓慢匀速向上升起，逐渐展示整个[场景名]的全貌，最终定格在尾帧的高空俯拍视角

【降镜头】
镜头从首帧的高空俯拍视角，缓慢匀速向下降落，逐渐聚焦到[主体]身上，最终定格在尾帧的中景视角

运镜过程平滑流畅，速度均匀，无卡顿，无跳跃；人物姿势不变，表情自然，无穿模，无变形
无字幕，无水印，无多余元素`

/** 跟拍 / POV */
const VIDEO_CAMERA_FOLLOW_BODY = `${VIDEO_FL2V_PREFIX}

【跟拍 / POV】
POV 跟随视角，镜头跟随[主体]一起向前移动，始终保持[主体]在画面正中央，运镜速度与人物移动速度一致

运镜过程平滑流畅，速度均匀，无卡顿，无跳跃；表情自然，无穿模，无变形
无字幕，无水印，无多余元素`

/** 组合运镜 */
const VIDEO_CAMERA_COMBO_BODY = `${VIDEO_FL2V_PREFIX}

【组合运镜示例】
镜头先从首帧的远景缓慢向前推进到[主体]的中景，然后围绕[主体]做180度环绕运动，最后缓慢向后拉远回到全景，最终定格在尾帧

可按需改写段落顺序与运镜类型（推/拉/摇/移/环绕/升降/跟拍）。
运镜过程平滑流畅，速度均匀，无卡顿，无跳跃；人物姿势不变，表情自然，无穿模，无变形
无字幕，无水印，无多余元素`

/** 文生视频简模 */
const VIDEO_TEXT_TO_VIDEO_BODY = `请根据下列描述生成一段视频（文生视频，无参考素材时也可执行）。

【画面】[主体 / 动作 / 场景 / 时间与天气]
【镜头】[景别与运镜，如中景推进、缓慢横移]
【风格】[如电影质感、写实光影、UE5 建模风]
【时长节奏】动作清晰完整，过程连贯，无跳切感
【禁项】无字幕，无水印，无多余文字与 UI`

/** 全能 / 多参考简模（帧模式选「无」或「仅首帧」；勿与首尾帧模式混用参考图） */
const VIDEO_MULTIMODAL_REF_BODY = `请基于已连接的参考素材生成视频（帧模式勿选「首尾帧」；需要指代端口时用指令栏「@」芯片插入，勿在模板中写死端口号）。

【参考】主体参考 [主体参考图，可选]；风格或场景参考 [风格/场景参考，可选]；动作/视频参考 [动作参考，可选]；声音参考 [声音参考，可选]
【叙事】[一句话剧情与情绪]
【镜头】[景别、运镜、起止构图]
【约束】尽量保持参考中的人物外观、服装与场景一致；运动自然，光影统一
【禁项】无字幕，无水印，无多余元素；不要同时连接尾帧口与参考图`

/** 与「建立镜头」图片预设成对：这里只描述动起来的部分。 */
const VIDEO_SHOT_ESTABLISH_BODY = `基于首帧或参考图生成建立镜头。
【运动】镜头缓慢横移或小幅升降；环境中的灯光、雨雾、树叶、人流等持续发生细微变化
【节奏】先稳定观察，再在结尾轻微靠近叙事主体，为下一镜留出剪切点
【约束】不重新设计场景；保持首帧构图、主体身份、光影方向与空间连续。`

/** 与「插入特写」图片预设成对。 */
const VIDEO_SHOT_DETAIL_BODY = `基于首帧或参考图，让关键细节完成一个清晰动作。
【动作】[按下、握紧、换挡、指针攀升、眼神锁定等单一动作]
【物理反馈】加入材质震动、反光变化、烟雾/水花/发丝等合理反馈
【镜头】动作冲击点可有一次短促微震或快速微推，随后立即稳定
【约束】单镜只完成一个核心动作，避免多个方向同时运动。`

const VIDEO_HERO_ENTRANCE_BODY = `生成英雄式人物出场镜头。
低机位从脚步、手部或服装细节开始，随人物进入场景缓慢上摇并推进，经中景落到面部特写。
强轮廓逆光和空气介质保持连续；人物动作沉稳，风、尘、衣摆提供物理反馈。
不要一开始就完全展示面部；无字幕、水印或多余人物。`

const VIDEO_PERFORMANCE_BODY = `生成以人物真实表演为核心的视频。
把[抽象情绪]拆成具体时序：先[眼眉变化]，随后[嘴唇/鼻翼/下颌动作]，再由[肩颈/手指/重心]响应。
镜头保持克制，仅用轻微手持、停顿或微推强调情绪节点；避免僵硬笑容、面部融化、夸张抽搐。`

/** —— 常用姿势（身体朝向 / 基础动作）—— */

const VIDEO_POSE_STANDING_FRONT_BODY = `生成人物常用姿势：严格全正面站立。
【姿势】[主体] 正对镜头站立，双脚自然开立，重心稳定；双臂自然下垂或在画面下方做细微有动机的手势。
【表情】眼神看向镜头，面部情绪直接可读：[情绪]。
【景别】半身至中景；镜头稳定或极轻微推近。
【约束】保持人物比例与服装细节清晰；无多余人物；无字幕、水印与 UI。`

const VIDEO_POSE_THREE_QUARTER_BODY = `生成人物常用姿势：45度（三分之四侧面）站立。
【姿势】[主体] 身体朝向约45度，兼顾面部表情与身体立体感；加入视线扫动、手指动作或重心微调。
【表情】[情绪] 清晰可读，避免面部被过度遮挡。
【景别】半身景；镜头稳定或缓慢环绕小幅弧线。
【约束】保持外观一致；动作自然；无字幕、水印与 UI。`

const VIDEO_POSE_PROFILE_BODY = `生成人物常用姿势：纯侧面站立/半身。
【姿势】[主体] 呈清晰侧影轮廓，视线专注于画外[目标]而非镜头；肩线、下颌与鼻梁轮廓分明。
【表演】用呼吸起伏、指尖动作或轻微重心变化传递[情绪]。
【景别】特写至半身；镜头稳定旁观。
【约束】避免正脸露出；无字幕、水印与 UI。`

const VIDEO_POSE_BACK_BODY = `生成人物常用姿势：严格背面站立。
【姿势】[主体] 背对镜头，与观众共同望向[场景/目标]；用肩线、头部偏转、手部动作与重心变化传递[情绪]。
【节奏】可在结尾轻微转头露出侧脸轮廓，但不提前露出正脸。
【景别】中远景至中景；镜头缓慢推进或横移。
【约束】人物身份与服装从背面仍可辨认；无字幕、水印与 UI。`

const VIDEO_POSE_WALK_BODY = `生成人物常用姿势：自然走路。
【姿势】[主体] 以自然步态向前行走，手臂随步伐摆动，重心在左右脚间切换；发丝与衣摆有轻微惯性。
【方向】朝[画内方向]行走；视线看向前进方向或短暂扫向镜头。
【镜头】侧跟或斜跟，保持半身至中景构图稳定。
【约束】步幅真实、无脚底滑动；无字幕、水印与 UI。`

const VIDEO_POSE_SIT_BODY = `生成人物常用姿势：坐姿。
【姿势】[主体] 坐在[椅子/台阶/地面]上，躯干端正或略前倾；双手放在[膝上/扶手/交握]，双脚自然落地或交叠。
【表演】加入一次重心微调、整理衣角或抬眼看向[目标]。
【景别】半身至中景；镜头稳定或轻微下摇到坐姿全貌后回。
【约束】坐姿比例协调，无穿模；无字幕、水印与 UI。`

const VIDEO_POSE_LOOK_BACK_BODY = `生成人物常用姿势：回眸。
【姿势】[主体] 先面向画外[目标]，随后肩颈带动头部回看镜头或回看追赶者；发丝与衣领随转动有惯性。
【表情】回眸瞬间给出[情绪]（惊讶/警惕/柔和等），眼神清晰。
【景别】半身景；回眸瞬间可短促微推后稳定。
【约束】转动过程连续，无跳切感；无字幕、水印与 UI。`

const VIDEO_POSE_HANDS_ON_HIPS_BODY = `生成人物常用姿势：双手叉腰自信站立。
【姿势】[主体] 正面或微侧对镜头站立，双手叉腰，肘部外展，胸部打开，重心落在双脚。
【表演】下巴微抬，目光坚定看向镜头或[目标]；可有一次深呼吸或衣摆被风轻吹。
【景别】中景至半身；镜头稳定或缓慢上摇强调气场。
【约束】姿态有力但不僵硬；无字幕、水印与 UI。`

const VIDEO_POSE_RUN_BODY = `生成人物常用姿势：跑步。
【姿势】[主体] 向前奔跑，膝盖抬起、摆臂有力，重心前倾；呼吸与步伐节奏匹配。
【环境】[场景] 中有合理动态反馈（尘土、衣摆、发丝）。
【镜头】跟拍或斜侧跟，保持半身至中景；允许轻微手持晃动增强速度感。
【约束】脚步落地真实，避免漂浮感；无字幕、水印与 UI。`

const VIDEO_TRANSITION_HARD_BODY = `设计一个广告快节奏硬切镜头。
当前镜头只完成一个清晰动作，并在动作最有力的瞬间切入下一镜。
切点前保留极短停顿或冲击；下一镜用匹配的动作方向、构图位置或声音延续能量。
不要生成溶解叠化，不要在一个镜头里塞入完整故事。`

const VIDEO_TRANSITION_FLASH_BODY = `设计闪白/闪黑转场。
让画面内有动机的光源、高光、闪光灯或遮挡快速充满画面，在峰值切换下一镜；
下一镜从相同亮度与光线方向恢复，保持主体和空间逻辑可读，避免无来源的纯特效闪烁。`

const VIDEO_TRANSITION_MOTION_BODY = `设计运动匹配转场。
让主体或镜头快速向[左/右/上/下]扫过，形成自然运动模糊；
在速度峰值切入下一镜，并以相同方向、速度和画面重心继续运动，随后平稳减速。
运动必须有物理惯性，避免瞬移、穿模和背景扭曲。`

/** 首图负责起始状态，尾图负责结果；视频只负责一条可解释的运动路径。 */
const VIDEO_FRAME_PAIR_CONTINUITY_BODY = `使用已连接的首帧和尾帧生成连贯镜头。
【首帧】把首帧视为真实起始状态，不重新构图或改变人物、产品、服装与场景。
【核心动作】只填写一个动作：[主体]从[起始姿态/位置]经过[关键动作]到达尾帧的[结果姿态/位置]。
【镜头路径】[机位起点]以[速度曲线]沿[单一方向]移动到尾帧机位；焦点从[起始焦点]自然转移到[结束焦点]。
【连续性】保持屏幕运动方向、光源方向、物体数量和空间轴线一致；补全中间过程，不让首尾帧直接变形互溶。
【物理反馈】仅加入与动作有关的衣摆、发丝、阴影、反射、尘雾或水花反馈。
禁止新增主体、镜头瞬移、身份变化、肢体融化和无动机转场。`

const VIDEO_FRAME_PAIR_PRODUCT_BODY = `使用已连接的产品首帧和尾帧生成「细节到英雄镜头」。
【起点】从首帧的材质、标识或功能结构特写开始，保留真实纹理、微划痕、凝露与受控反射。
【揭示】镜头缓慢推进或小幅环绕，条形高光沿曲面移动并揭示结构；产品自身只做一个明确功能动作。
【终点】自然拉远或升降至尾帧完整产品构图，产品居于视觉中心，卖点清晰，最后稳定停留。
【一致性】产品形状、文字标识、零件数量和光源方向全程不变；避免漂浮、软化、重绘和无来源粒子。`

const VIDEO_FRAME_PAIR_TRANSITION_BODY = `使用首帧和尾帧设计可剪辑的匹配转场。
先选择唯一匹配依据：[形状 / 颜色 / 构图位置 / 运动方向 / 前景遮挡 / 有动机光源]。
首帧中的对应元素沿[方向]逐渐占据画面，在遮满、过曝、虚焦或速度峰值时完成场景替换；
尾帧从相同画面位置、亮度和运动方向继续，再平稳显露新主体。
保持转场前后主体身份与各自场景稳定，不把两个场景长时间溶成一团；转场动作控制在镜头中段，首尾各留稳定剪辑余量。`

const VIDEO_TRANSITION_DISSOLVE_BODY = `设计舒缓的短叠化转场。
当前镜头结尾让主体稳定、动作幅度逐渐降低；下一镜选择相近的色调、亮度、构图重心和情绪强度。
只在两镜的稳定区间做短叠化，不让人物五官、肢体或产品文字相互融合。
适合回忆、时间流逝、风景与情绪段落；若场景冲击强烈，应改用硬切。`

const VIDEO_TRANSITION_OCCLUSION_BODY = `设计前景遮挡转场。
让人物、产品、车辆、墙面或其他有动机前景从[方向]靠近并完全遮满镜头；
在画面被遮满的一瞬切换场景，下一镜由相似颜色和运动速度的遮挡物沿同方向移开。
遮挡前后机位高度与运动惯性保持连续，禁止物体穿模或凭空出现。`

const VIDEO_TRANSITION_FOCUS_BODY = `设计虚焦揭示转场。
焦点从当前主体缓慢移开，使其变为可控光斑或大色块并充满主要画面；
下一镜从相近颜色、亮度和轮廓的模糊状态开始，再平滑对焦到新主体。
保持曝光稳定，不用无来源闪白；人物面部与产品文字只在完全对焦后清晰出现。`

const VIDEO_PRESETS: InstructionPreset[] = [
  {
    id: 'video.firstLastFrame',
    titleKey: 'graph.inspector.generate.presets.video.firstLastFrame',
    body: VIDEO_FIRST_LAST_FRAME_BODY
  },
  {
    id: 'video.cameraDolly',
    titleKey: 'graph.inspector.generate.presets.video.cameraDolly',
    body: VIDEO_CAMERA_DOLLY_BODY
  },
  {
    id: 'video.cameraPanTilt',
    titleKey: 'graph.inspector.generate.presets.video.cameraPanTilt',
    body: VIDEO_CAMERA_PAN_TILT_BODY
  },
  {
    id: 'video.cameraOrbit',
    titleKey: 'graph.inspector.generate.presets.video.cameraOrbit',
    body: VIDEO_CAMERA_ORBIT_BODY
  },
  {
    id: 'video.cameraCrane',
    titleKey: 'graph.inspector.generate.presets.video.cameraCrane',
    body: VIDEO_CAMERA_CRANE_BODY
  },
  {
    id: 'video.cameraFollow',
    titleKey: 'graph.inspector.generate.presets.video.cameraFollow',
    body: VIDEO_CAMERA_FOLLOW_BODY
  },
  {
    id: 'video.cameraCombo',
    titleKey: 'graph.inspector.generate.presets.video.cameraCombo',
    body: VIDEO_CAMERA_COMBO_BODY
  },
  {
    id: 'video.textToVideo',
    titleKey: 'graph.inspector.generate.presets.video.textToVideo',
    body: VIDEO_TEXT_TO_VIDEO_BODY
  },
  {
    id: 'video.multimodalRef',
    titleKey: 'graph.inspector.generate.presets.video.multimodalRef',
    body: VIDEO_MULTIMODAL_REF_BODY
  },
  {
    id: 'video.shotEstablish',
    titleKey: 'graph.inspector.generate.presets.video.shotEstablish',
    body: VIDEO_SHOT_ESTABLISH_BODY
  },
  {
    id: 'video.shotDetail',
    titleKey: 'graph.inspector.generate.presets.video.shotDetail',
    body: VIDEO_SHOT_DETAIL_BODY
  },
  {
    id: 'video.heroEntrance',
    titleKey: 'graph.inspector.generate.presets.video.heroEntrance',
    body: VIDEO_HERO_ENTRANCE_BODY
  },
  {
    id: 'video.performanceRealism',
    titleKey: 'graph.inspector.generate.presets.video.performanceRealism',
    body: VIDEO_PERFORMANCE_BODY
  },
  {
    id: 'video.poseStandingFront',
    titleKey: 'graph.inspector.generate.presets.video.poseStandingFront',
    body: VIDEO_POSE_STANDING_FRONT_BODY,
    visual: { kind: 'facing', facing: 'front', shotSize: 'mediumClose' }
  },
  {
    id: 'video.poseThreeQuarter',
    titleKey: 'graph.inspector.generate.presets.video.poseThreeQuarter',
    body: VIDEO_POSE_THREE_QUARTER_BODY,
    visual: { kind: 'facing', facing: 'threeQuarter', shotSize: 'mediumClose' }
  },
  {
    id: 'video.poseProfile',
    titleKey: 'graph.inspector.generate.presets.video.poseProfile',
    body: VIDEO_POSE_PROFILE_BODY,
    visual: { kind: 'facing', facing: 'profile', shotSize: 'close' }
  },
  {
    id: 'video.poseBack',
    titleKey: 'graph.inspector.generate.presets.video.poseBack',
    body: VIDEO_POSE_BACK_BODY,
    visual: { kind: 'facing', facing: 'back', shotSize: 'medium' }
  },
  {
    id: 'video.poseWalk',
    titleKey: 'graph.inspector.generate.presets.video.poseWalk',
    body: VIDEO_POSE_WALK_BODY,
    visual: { kind: 'camera', camera: 'follow', shotSize: 'medium' }
  },
  {
    id: 'video.poseSit',
    titleKey: 'graph.inspector.generate.presets.video.poseSit',
    body: VIDEO_POSE_SIT_BODY,
    visual: { kind: 'shotSize', shotSize: 'mediumClose', camera: 'static' }
  },
  {
    id: 'video.poseLookBack',
    titleKey: 'graph.inspector.generate.presets.video.poseLookBack',
    body: VIDEO_POSE_LOOK_BACK_BODY,
    visual: { kind: 'facing', facing: 'backThreeQuarter', shotSize: 'mediumClose' }
  },
  {
    id: 'video.poseHandsOnHips',
    titleKey: 'graph.inspector.generate.presets.video.poseHandsOnHips',
    body: VIDEO_POSE_HANDS_ON_HIPS_BODY,
    visual: { kind: 'facing', facing: 'front', shotSize: 'medium' }
  },
  {
    id: 'video.poseRun',
    titleKey: 'graph.inspector.generate.presets.video.poseRun',
    body: VIDEO_POSE_RUN_BODY,
    visual: { kind: 'camera', camera: 'follow', shotSize: 'medium' }
  },
  {
    id: 'video.framePairContinuity',
    titleKey: 'graph.inspector.generate.presets.video.framePairContinuity',
    body: VIDEO_FRAME_PAIR_CONTINUITY_BODY
  },
  {
    id: 'video.framePairProduct',
    titleKey: 'graph.inspector.generate.presets.video.framePairProduct',
    body: VIDEO_FRAME_PAIR_PRODUCT_BODY
  },
  {
    id: 'video.framePairTransition',
    titleKey: 'graph.inspector.generate.presets.video.framePairTransition',
    body: VIDEO_FRAME_PAIR_TRANSITION_BODY
  },
  {
    id: 'video.transitionHard',
    titleKey: 'graph.inspector.generate.presets.video.transitionHard',
    body: VIDEO_TRANSITION_HARD_BODY
  },
  {
    id: 'video.transitionFlash',
    titleKey: 'graph.inspector.generate.presets.video.transitionFlash',
    body: VIDEO_TRANSITION_FLASH_BODY
  },
  {
    id: 'video.transitionMotion',
    titleKey: 'graph.inspector.generate.presets.video.transitionMotion',
    body: VIDEO_TRANSITION_MOTION_BODY
  },
  {
    id: 'video.transitionDissolve',
    titleKey: 'graph.inspector.generate.presets.video.transitionDissolve',
    body: VIDEO_TRANSITION_DISSOLVE_BODY
  },
  {
    id: 'video.transitionOcclusion',
    titleKey: 'graph.inspector.generate.presets.video.transitionOcclusion',
    body: VIDEO_TRANSITION_OCCLUSION_BODY
  },
  {
    id: 'video.transitionFocus',
    titleKey: 'graph.inspector.generate.presets.video.transitionFocus',
    body: VIDEO_TRANSITION_FOCUS_BODY
  }
]
const LIP_SYNC_TALKING_HEAD_BODY = `图片1中的角色对着镜头自然说话，口型与表情严格跟随音频1。
中近景，轻微点头与手势，眼神看向镜头，画面稳定。
不要字幕、水印或多余 UI。`

const LIP_SYNC_PERFORMANCE_BODY = `图片1中的角色根据音频1进行表演式对口型：情绪随语音起伏，口型精准同步。
半身景别，允许自然转头与手势，光影与参考图一致。
不要字幕、水印或多余文字。`

const LIP_SYNC_FROM_VIDEO_BODY = `保持视频1中的角色形象、运镜与动作，让角色口型严格跟随音频1。
尽量保留原视频场景、构图与节奏，仅替换说话口型与表情。
不要字幕、水印或多余 UI。`

const LIP_SYNC_PRESETS: InstructionPreset[] = [
  {
    id: 'lipSync.talkingHead',
    titleKey: 'graph.inspector.generate.presets.lipSync.talkingHead',
    body: LIP_SYNC_TALKING_HEAD_BODY
  },
  {
    id: 'lipSync.performance',
    titleKey: 'graph.inspector.generate.presets.lipSync.performance',
    body: LIP_SYNC_PERFORMANCE_BODY
  },
  {
    id: 'lipSync.fromVideo',
    titleKey: 'graph.inspector.generate.presets.lipSync.fromVideo',
    body: LIP_SYNC_FROM_VIDEO_BODY
  }
]

/** 片段重拍：修改要求模板（时间戳区间由节点参数写入 prompt） */
const RESHOOT_PRESETS: InstructionPreset[] = [
  {
    id: 'reshoot.prop',
    titleKey: 'graph.inspector.generate.presets.reshoot.prop',
    body: '将目标区间内的道具改为：___。保持人物、场景、镜头与声音不变。'
  },
  {
    id: 'reshoot.scene',
    titleKey: 'graph.inspector.generate.presets.reshoot.scene',
    body: '将目标区间的背景/场景改为：___。保持人物动作、镜头与声音不变。'
  },
  {
    id: 'reshoot.camera',
    titleKey: 'graph.inspector.generate.presets.reshoot.camera',
    body: '保持人物与环境不变，将目标区间的镜头改为：___。'
  },
  {
    id: 'reshoot.performance',
    titleKey: 'graph.inspector.generate.presets.reshoot.performance',
    body: '将目标区间的人物表演/动作改为：___，其余保持一致。'
  }
]

const VOICE_PRESETS: InstructionPreset[] = []

/** ——— 图片反推提示词：通用 ——— */
const TO_PROMPT_GENERAL_STRUCTURED_BODY = `请根据图片输出可复用的结构化中文生图提示词，按下列段落书写（不要解释过程）：
1. 主体：身份/物种、年龄感、服饰、姿态、表情、关键道具
2. 环境：场景类型、时间、天气、前景/中景/背景层次
3. 构图：景别、机位高低、视角、主体在画面中的位置
4. 光影：主光方向与质感、对比、氛围色
5. 风格：媒介（写实/插画/3D 等）、画质关键词、色彩倾向
6. 细节：材质、纹理、必须保留的辨识点
禁止编造图中不存在的重要物体；不确定处用「疑似」标注。`

const TO_PROMPT_GENERAL_SUBJECT_BODY = `聚焦主体反推提示词：
- 精确描述主体外形、服饰层次、材质与配饰
- 姿态、手势、眼神与情绪
- 与主体直接接触的道具
- 忽略无关背景杂讯，仅用一句交代环境即可
输出为可直接用于文生图的中文提示词，分短句，逗号分隔。`

const TO_PROMPT_GENERAL_STYLE_BODY = `侧重风格反推：
- 媒介与技法（摄影/油画/二次元/赛博/像素等）
- 色彩体系、对比度、颗粒/笔触感
- 时代感或艺术流派关键词
- 画面完成度与渲染级别（如胶片、UE5、手绘线稿）
主体与场景各用 1–2 句概括，重点给出可复用的风格词库（中文）。`

const TO_PROMPT_GENERAL_LIGHT_BODY = `侧重构图与光影反推：
- 景别、构图法则（三分/中心/引导线等）
- 镜头感：焦距印象、景深、畸变
- 主光/辅光/轮廓光、色温、阴影软硬
- 氛围关键词（清晨、霓虹、烛光等）
输出中文提示词，光影与构图词占比不少于一半。`

/** ——— 图片反推提示词：游戏 ——— */
const TO_PROMPT_GAME_CHARACTER_BODY = `按游戏角色设定图标准反推中文提示词：
- 全身或半身设定观感；姿态尽量可读（如 A-pose / 展示型站姿）
- 发型、五官、体型、服装分层、配色与标志性配件
- 材质：布料/金属/皮革/能量特效等
- 风格：手游立绘 / 次世代写实 / 卡通风 等（从图判断）
- 背景尽量简化或纯色；不要把剧情场景写进角色设定
禁止过度美颜表述；保留可辨识特征。`

const TO_PROMPT_GAME_SCENE_BODY = `按游戏场景概念图反推：
- 场景类型（城镇/副本/野外/室内功能区）
- 空间层次、可行走暗示、地标与氛围
- 时代与美术风格（古风/科幻/卡通等）
- 光照与天气对玩法氛围的影响
- 空场景优先：少写或不写具体 NPC 剧情动作
输出可直接用于场景概念生成的中文提示词。`

const TO_PROMPT_GAME_UI_BODY = `按游戏 UI / 图标资产反推：
- 资产类型：图标 / 按钮 / 弹窗框 / Banner / HUD 元件（从图判断）
- 形状、描边、内发光、材质质感、角标与装饰
- 清晰可读性、对称与安全边距印象
- 风格：扁平 / 半写实 / 卡通描边 / 科技面板 等
- 背景：透明感或纯色底；避免复杂实景
输出中文提示词，强调「可切片、可复用」的设计语言。`

const TO_PROMPT_GAME_PROP_BODY = `按游戏道具 / 武器 / 物品图标反推：
- 物品品类与用途暗示
- 外形轮廓、部件结构、材质与磨损/附魔特效
- 展示角度（四分之三 / 正面 Orthographic 感）
- 纯色或简洁背景；不要写环境故事
输出适合道具设定或商店图标的中文提示词。`

const TO_PROMPT_GAME_UA_BODY = `按游戏买量静帧 / 广告主视觉反推：
- 钩子冲突：谁在对抗什么、情绪爆点
- 角色辨识点 + 夸张表情/动作
- 利益点或玩法卖点的视觉化（升级、抽卡、对战等，仅写图中可见）
- 强对比光影、高饱和或强明暗、适合竖版/横版的构图重心
- CTA 区域若存在（按钮、文案板）单独描述样式，勿臆造文案内容
输出可复用的买量静帧中文提示词。`

const TO_PROMPT_GAME_VFX_BODY = `按游戏技能 / 特效关键帧反推：
- 特效类型（斩击/爆炸/治疗/增益光环等）
- 形状语言、粒子、拖尾、冲击波
- 主色与能量感、与角色/武器的附着关系
- 透明通道与叠加感（Additive 印象）
- 背景尽量弱化，突出特效可读性
输出适合特效概念或关键帧生成的中文提示词。`

/** ——— 图片反推提示词：影视 ——— */
const TO_PROMPT_FILM_ESTABLISH_BODY = `按影视建立镜头 / 空镜标准反推：
- 景别与空间关系（远景/全景为主）
- 环境叙事：地点、时间、天气、时代感
- 构图与引导线、地标或视觉锚点
- 电影感光影与色彩调性（青橙、低对比、胶片等）
- 尽量少写对白情节，侧重「一场戏从哪里开始」
输出中文电影级画面提示词。`

const TO_PROMPT_FILM_CLOSEUP_BODY = `按影视人物特写 / 表演镜头反推：
- 景别（大特写/特写/近景）与焦点落点
- 表情、眼神、微表情与情绪张力
- 肤质、妆造、发型、服装领口细节
- 眼神光、伦勃朗/蝴蝶光等布光印象
- 浅景深与焦外
输出适合角色表演参考的中文提示词。`

const TO_PROMPT_FILM_LIGHT_BODY = `按影视光影与调色反推：
- 主光方向、硬软光、轮廓光与环境光比
- 色温与色彩剧本（冷暖分区、互补色）
- 烟雾/丁达尔/雨夜反光等大气光学
- 整体 look：好莱坞、独立电影、港片、日剧等（从图判断）
主体与场景各一句，光影词为主，输出中文提示词。`

const TO_PROMPT_FILM_STORYBOARD_BODY = `按分镜画 / 场次画反推：
- 镜头功能（建立/主观/正反打/插入）
- 景别、机位、轴线关系暗示
- 角色站位与动作箭头感（若有）
- 画面信息优先级：先叙事后装饰
- 风格：线稿分镜 / 彩色概念分镜（从图判断）
输出可继续改镜的中文分镜描述提示词。`

const TO_PROMPT_FILM_COSTUME_BODY = `按造型 / 服装 / 美术设定反推：
- 服装廓形、层次、面料与时代/世界观
- 妆发与角色身份符号
- 道具与随身物件的叙事功能
- 材质特写级描述，背景从简
输出适合服化道参考的中文提示词。`

const TO_PROMPT_FILM_CAMERA_BODY = `按镜头语言反推（服务后续视频/分镜）：
- 景别、机位高度、俯仰、是否广角/长焦感
- 运动暗示：固定/微移/推拉/环绕（仅写图中可感）
- 构图重心与负空间
- 焦点与景深策略
- 电影术语关键词（中文）
输出偏「可执行镜头说明」的中文提示词。`

const TO_PROMPT_PRESETS: InstructionPreset[] = [
  // 通用
  {
    id: 'toPrompt.general.structured',
    titleKey: 'graph.inspector.generate.presets.toPrompt.structured',
    tab: 'general',
    body: TO_PROMPT_GENERAL_STRUCTURED_BODY
  },
  {
    id: 'toPrompt.general.subject',
    titleKey: 'graph.inspector.generate.presets.toPrompt.subject',
    tab: 'general',
    body: TO_PROMPT_GENERAL_SUBJECT_BODY
  },
  {
    id: 'toPrompt.general.style',
    titleKey: 'graph.inspector.generate.presets.toPrompt.style',
    tab: 'general',
    body: TO_PROMPT_GENERAL_STYLE_BODY
  },
  {
    id: 'toPrompt.general.light',
    titleKey: 'graph.inspector.generate.presets.toPrompt.light',
    tab: 'general',
    body: TO_PROMPT_GENERAL_LIGHT_BODY
  },
  // 游戏
  {
    id: 'toPrompt.game.character',
    titleKey: 'graph.inspector.generate.presets.toPrompt.gameCharacter',
    tab: 'game',
    body: TO_PROMPT_GAME_CHARACTER_BODY
  },
  {
    id: 'toPrompt.game.scene',
    titleKey: 'graph.inspector.generate.presets.toPrompt.gameScene',
    tab: 'game',
    body: TO_PROMPT_GAME_SCENE_BODY
  },
  {
    id: 'toPrompt.game.ui',
    titleKey: 'graph.inspector.generate.presets.toPrompt.gameUi',
    tab: 'game',
    body: TO_PROMPT_GAME_UI_BODY
  },
  {
    id: 'toPrompt.game.prop',
    titleKey: 'graph.inspector.generate.presets.toPrompt.gameProp',
    tab: 'game',
    body: TO_PROMPT_GAME_PROP_BODY
  },
  {
    id: 'toPrompt.game.ua',
    titleKey: 'graph.inspector.generate.presets.toPrompt.gameUa',
    tab: 'game',
    body: TO_PROMPT_GAME_UA_BODY
  },
  {
    id: 'toPrompt.game.vfx',
    titleKey: 'graph.inspector.generate.presets.toPrompt.gameVfx',
    tab: 'game',
    body: TO_PROMPT_GAME_VFX_BODY
  },
  // 影视
  {
    id: 'toPrompt.film.establish',
    titleKey: 'graph.inspector.generate.presets.toPrompt.filmEstablish',
    tab: 'film',
    body: TO_PROMPT_FILM_ESTABLISH_BODY
  },
  {
    id: 'toPrompt.film.closeup',
    titleKey: 'graph.inspector.generate.presets.toPrompt.filmCloseup',
    tab: 'film',
    body: TO_PROMPT_FILM_CLOSEUP_BODY
  },
  {
    id: 'toPrompt.film.light',
    titleKey: 'graph.inspector.generate.presets.toPrompt.filmLight',
    tab: 'film',
    body: TO_PROMPT_FILM_LIGHT_BODY
  },
  {
    id: 'toPrompt.film.storyboard',
    titleKey: 'graph.inspector.generate.presets.toPrompt.filmStoryboard',
    tab: 'film',
    body: TO_PROMPT_FILM_STORYBOARD_BODY
  },
  {
    id: 'toPrompt.film.costume',
    titleKey: 'graph.inspector.generate.presets.toPrompt.filmCostume',
    tab: 'film',
    body: TO_PROMPT_FILM_COSTUME_BODY
  },
  {
    id: 'toPrompt.film.camera',
    titleKey: 'graph.inspector.generate.presets.toPrompt.filmCamera',
    tab: 'film',
    body: TO_PROMPT_FILM_CAMERA_BODY
  }
]
const OPTIMIZE_PRESETS: InstructionPreset[] = [
  {
    id: 'optimize.character',
    titleKey: 'graph.inspector.generate.presets.optimize.character',
    body: OPTIMIZE_CHARACTER_BODY
  },
  {
    id: 'optimize.prop',
    titleKey: 'graph.inspector.generate.presets.optimize.prop',
    body: OPTIMIZE_PROP_BODY
  },
  {
    id: 'optimize.scene',
    titleKey: 'graph.inspector.generate.presets.optimize.scene',
    body: OPTIMIZE_SCENE_BODY
  },
  {
    id: 'optimize.camera',
    titleKey: 'graph.inspector.generate.presets.optimize.camera',
    body: OPTIMIZE_CAMERA_BODY
  },
  {
    id: 'optimize.expression',
    titleKey: 'graph.inspector.generate.presets.optimize.expression',
    body: OPTIMIZE_EXPRESSION_BODY
  },
  {
    id: 'optimize.vfx',
    titleKey: 'graph.inspector.generate.presets.optimize.vfx',
    body: OPTIMIZE_VFX_BODY
  },
  {
    id: 'optimize.episodeBreakdown',
    titleKey: 'graph.inspector.generate.presets.optimize.episodeBreakdown',
    body: episodePresetBody(EPISODE_AGENT_BREAKDOWN)
  },
  {
    id: 'optimize.episodeBeatBoard',
    titleKey: 'graph.inspector.generate.presets.optimize.episodeBeatBoard',
    body: episodePresetBody(EPISODE_AGENT_BEATBOARD)
  },
  {
    id: 'optimize.episodeSequenceBoard',
    titleKey: 'graph.inspector.generate.presets.optimize.episodeSequenceBoard',
    body: episodePresetBody(EPISODE_AGENT_SEQUENCE)
  },
  {
    id: 'optimize.episodeMotionPrompt',
    titleKey: 'graph.inspector.generate.presets.optimize.episodeMotionPrompt',
    body: episodePresetBody(EPISODE_AGENT_MOTION)
  },
  {
    id: 'optimize.episodeDirectorReview',
    titleKey: 'graph.inspector.generate.presets.optimize.episodeDirectorReview',
    body: episodePresetBody(EPISODE_AGENT_DIRECTOR)
  }
]

/** 剧本拆分为分镜表（输出由系统提示词约束为表格 JSON） */
const WORLD_EXTRACT_CREATE_BODY = `请从下列文本提取世界元素目录，并严格按系统提示词规定的 JSON 对象格式输出（顶层：characters / scenes / props / weapons；每项含 id、name、prompt、status）。
要求：
1. 只输出 JSON；空类用 []；顶层键不得增减。
2. 分类边界清晰：角色 / 场景 / 道具 / 武器；服装外观写进角色，勿重复拆条；兵器归 weapons，非武器互动物件归 props。
3. 合并同名异称；id 用稳定英文 slug。
4. 先根据剧本提炼详细视觉风格简报（类型、时代、媒介、色板、光影、纹理），再写入每条 prompt；全目录风格一致。禁止强制套用 UE5 / 真人建模 / PBR 口号等固定模板（除非剧本本身明确要求）。
5. prompt 必须可直接生图：主体外观、材质、光影、构图 + 剧本风格；禁止剧情摘要与对白。
6. 硬性构图：角色=正面朝镜头+纯色背景（禁止环境/场景）；场景=空无一人（禁止任何人物）；道具/武器=纯色底产品照（禁止环境背景）。
7. status 新项填「未审核」；若输入已有「已审核」项必须原样保留。
8. 宁缺毋滥，优先有辨识度的可复用元素。

文本内容：`

const WORLD_EXTRACT_REFINE_BODY = `请优化下列世界元素目录，并严格按系统提示词规定的 JSON 对象格式重新输出（顶层键与字段不变）。
要求：
1. 合并重复项，修正错误分类（角色/场景/道具/武器）。
2. 若原 prompt 被固定成 UE5 / 真人建模等与剧本无关的模板，请改回「从剧本提炼」的详细风格，并统一全目录风格脊柱。
3. 强化每条 prompt 的外观、材质、光影、构图与剧本风格细节，使其更适合稳定生图。
4. 按硬性规范改写：角色正面纯色底无环境；场景去掉所有人物；道具/武器去掉场景背景改为纯色产品照。
5. 保留已有合理 id；仅在明显冲突时调整。
6. status 为「已审核」的项必须原样保留、不得修改。
7. 只输出 JSON。

目录内容：`

const WORLD_EXTRACT_PRESETS: InstructionPreset[] = [
  {
    id: 'spatialWorldExtract.create',
    titleKey: 'graph.inspector.generate.presets.spatialWorldExtract.create',
    body: WORLD_EXTRACT_CREATE_BODY
  },
  {
    id: 'spatialWorldExtract.refine',
    titleKey: 'graph.inspector.generate.presets.spatialWorldExtract.refine',
    body: WORLD_EXTRACT_REFINE_BODY
  }
]

const BEAT_SPLIT_CREATE_BODY = `请将下列剧本拆解为场，并严格按系统提示词规定的 JSON 数组格式输出。
硬性要求：
1. 粒度是场/节拍（一个场可对应后续多镜），禁止景别/运镜/构图。
2. 按故事顺序覆盖全文；在时间、地点、目标、冲突、动作或氛围发生有意义变化时拆分。
3. 每场尽量填齐六要素：time（时间）、location（空间与地点）、characters（角色）、action（核心动作与事件）、conflict（动机/冲突/目标）、atmosphere（氛围/光影/声音）；另填 durationHint、locations 地点绑定、sourceExcerpt。
4. id 使用 beat- 前缀；durationHint 优先 短|中|长；新建 status=未审核。
5. 只输出 JSON。

剧本内容：`

const BEAT_SPLIT_REFINE_BODY = `请优化下列场列表，并严格按系统提示词规定的 JSON 数组格式重新输出（字段集合不变）。
硬性要求：
1. 合并过碎的场，拆分时间、地点、目标、冲突或动作混杂的场。
2. 强化 time / location / action / conflict / atmosphere / sourceExcerpt 的信息密度与可定位性；地点与角色名前后一致。
3. 禁止改成镜头语言；禁止编造原文没有的情节。
4. status 为「已审核」的场必须原样保留、不得修改。
5. 只输出 JSON。

场内容：`

const BEAT_SPLIT_PRESETS: InstructionPreset[] = [
  {
    id: 'beatSplit.create',
    titleKey: 'graph.inspector.generate.presets.beatSplit.create',
    body: BEAT_SPLIT_CREATE_BODY
  },
  {
    id: 'beatSplit.refine',
    titleKey: 'graph.inspector.generate.presets.beatSplit.refine',
    body: BEAT_SPLIT_REFINE_BODY
  }
]

/** 帧动画序列图 · 武功动作预设：武侠拳脚招式，点击后写入指令框 */
const FRAME_ANIM_GEN_WUSHU_PRESETS: InstructionPreset[] = [
  {
    id: 'wushu.xianglong',
    titleKey: 'graph.inspector.generate.presets.frameAnimWushu.xianglong',
    tab: 'character',
    body: '降龙十八掌：双掌连环推出，每掌带金色龙形气浪，劲风扑面，最后一掌威力最大，包含完整发掌周期'
  },
  {
    id: 'wushu.taiji',
    titleKey: 'graph.inspector.generate.presets.frameAnimWushu.taiji',
    tab: 'character',
    body: '太极拳：缓慢圆转云手，重心沉稳，借力打力，动作连绵不断，包含完整云手循环'
  },
  {
    id: 'wushu.wuyingjiao',
    titleKey: 'graph.inspector.generate.presets.frameAnimWushu.wuyingjiao',
    tab: 'character',
    body: '佛山无影脚：身体腾空连环踢击，腿影密集如残影，落地稳健，包含完整连踢序列'
  },
  {
    id: 'wushu.zuiquan',
    titleKey: 'graph.inspector.generate.presets.frameAnimWushu.zuiquan',
    tab: 'character',
    body: '醉拳：脚步踉跄如醉，身体左右摇摆，突然出拳攻其不备，包含完整醉步出拳周期'
  },
  {
    id: 'wushu.cunquan',
    titleKey: 'graph.inspector.generate.presets.frameAnimWushu.cunquan',
    tab: 'character',
    body: '咏春寸拳：贴身短打，拳头在极短距离内爆发寸劲，命中瞬间震开对手，短促有力'
  },
  {
    id: 'wushu.shizihou',
    titleKey: 'graph.inspector.generate.presets.frameAnimWushu.shizihou',
    tab: 'character',
    body: '狮子吼：深吸气后张口怒吼，声波化作环形冲击气浪向外扩散，包含完整蓄力到释放周期'
  },
  {
    id: 'wushu.lingbo',
    titleKey: 'graph.inspector.generate.presets.frameAnimWushu.lingbo',
    tab: 'character',
    body: '凌波微步：身形如鬼魅快速移动，脚下轻点，残影连连，闪避自如，包含完整游走周期'
  },
  {
    id: 'wushu.saotangtui',
    titleKey: 'graph.inspector.generate.presets.frameAnimWushu.saotangtui',
    tab: 'character',
    body: '扫堂腿：低身下蹲，一腿横扫地面卷起尘土，扫倒对手，包含完整蓄力扫腿周期'
  },
  {
    id: 'wushu.tieshazhang',
    titleKey: 'graph.inspector.generate.presets.frameAnimWushu.tieshazhang',
    tab: 'character',
    body: '铁砂掌：马步蓄力，双掌连续劈击，掌风凌厉，包含完整劈掌序列'
  },
  {
    id: 'wushu.yiyangzhi',
    titleKey: 'graph.inspector.generate.presets.frameAnimWushu.yiyangzhi',
    tab: 'character',
    body: '一阳指：食指前点，指尖射出金色指劲光束，精准穿透，包含完整运劲点射周期'
  },
  {
    id: 'wushu.liumai',
    titleKey: 'graph.inspector.generate.presets.frameAnimWushu.liumai',
    tab: 'character',
    body: '六脉神剑：双掌连挥，指尖射出六道不同颜色的剑气，纵横交错，包含完整剑气连发序列'
  },
  {
    id: 'wushu.dugu',
    titleKey: 'graph.inspector.generate.presets.frameAnimWushu.dugu',
    tab: 'character',
    body: '独孤九剑：持剑快速连刺九剑，剑光如虹，破绽全无，包含完整九连刺序列'
  },
  {
    id: 'wushu.dianxue',
    titleKey: 'graph.inspector.generate.presets.frameAnimWushu.dianxue',
    tab: 'character',
    body: '葵花点穴手：身形前探，双指闪电般连点对手穴位，动作干脆利落，包含完整点穴序列'
  },
  {
    id: 'wushu.jinzhongzhao',
    titleKey: 'graph.inspector.generate.presets.frameAnimWushu.jinzhongzhao',
    tab: 'character',
    body: '金钟罩：马步运气，身体泛起金色光罩，硬抗攻击纹丝不动，包含完整运气护体周期'
  },
  {
    id: 'wushu.rulai',
    titleKey: 'graph.inspector.generate.presets.frameAnimWushu.rulai',
    tab: 'character',
    body: '如来神掌：跃起后单掌下压，金色巨掌虚影从天而降，带风压与光芒，包含完整出掌序列'
  },
  {
    id: 'wushu.tiyunzong',
    titleKey: 'graph.inspector.generate.presets.frameAnimWushu.tiyunzong',
    tab: 'character',
    body: '梯云纵：双脚踏空连纵，身形节节升高，轻灵飘逸，包含完整连续纵跃序列'
  }
]

/** 帧动画序列图 · 角色预设：动画动作即动作描述，点击后写入指令框 */
const FRAME_ANIM_GEN_CHARACTER_PRESETS: InstructionPreset[] = [
  ...ANIM2D_PRESETS.map((preset) => ({
    id: `anim2d.${preset.id}`,
    titleKey: `graph.anim2d.presets.${preset.labelKey}`,
    body: preset.prompt,
    tab: 'character' as const
  })),
  ...FRAME_ANIM_GEN_WUSHU_PRESETS
]

/** 帧动画序列图 · 特效预设：常用 2D 游戏特效，点击后写入指令框 */
const FRAME_ANIM_GEN_FX_PRESETS: InstructionPreset[] = [
  {
    id: 'fx.smoke',
    titleKey: 'graph.inspector.generate.presets.frameAnimFx.smoke',
    tab: 'fx',
    body: '2D 游戏烟雾特效循环：灰白色烟雾从底部升起，体积逐渐膨胀扩散，边缘柔和半透明，缓慢消散，包含完整的升腾到消散周期'
  },
  {
    id: 'fx.fire',
    titleKey: 'graph.inspector.generate.presets.frameAnimFx.fire',
    tab: 'fx',
    body: '2D 游戏火焰特效循环：火焰从底部窜起，火苗左右摇曳，内部亮黄外部橙红，顶部零星火星飘散，包含完整燃烧周期'
  },
  {
    id: 'fx.lightning',
    titleKey: 'graph.inspector.generate.presets.frameAnimFx.lightning',
    tab: 'fx',
    body: '2D 游戏闪电特效：屏幕边缘闪白，一道锯齿状闪电劈下，伴随瞬间高亮与余光衰减，包含完整放电周期'
  },
  {
    id: 'fx.explosion',
    titleKey: 'graph.inspector.generate.presets.frameAnimFx.explosion',
    tab: 'fx',
    body: '2D 游戏爆炸特效序列：依次为强闪光、火球膨胀、烟尘扩散、碎片飞溅、余烬下落，节奏快、动感强'
  },
  {
    id: 'fx.water',
    titleKey: 'graph.inspector.generate.presets.frameAnimFx.water',
    tab: 'fx',
    body: '2D 游戏水波特效循环：水面涟漪从中心向外扩散，波光闪动，边缘半透明，包含完整波动周期'
  },
  {
    id: 'fx.magic',
    titleKey: 'graph.inspector.generate.presets.frameAnimFx.magic',
    tab: 'fx',
    body: '2D 游戏魔法特效循环：彩色光点粒子从中心向外飘散，带拖尾光迹，闪烁明暗变化，神秘氛围'
  },
  {
    id: 'fx.rain',
    titleKey: 'graph.inspector.generate.presets.frameAnimFx.rain',
    tab: 'fx',
    body: '2D 游戏下雨特效循环：密集雨丝斜向下落，近处粗远景细，落地溅起小水花，持续循环'
  },
  {
    id: 'fx.snow',
    titleKey: 'graph.inspector.generate.presets.frameAnimFx.snow',
    tab: 'fx',
    body: '2D 游戏下雪特效循环：雪花缓慢飘落并左右摇摆，大小不一，近处清晰远处朦胧，持续循环'
  },
  {
    id: 'fx.spark',
    titleKey: 'graph.inspector.generate.presets.frameAnimFx.spark',
    tab: 'fx',
    body: '2D 游戏火花特效：金属撞击迸发橙黄色火花，向四周飞溅并快速熄灭，短促有力'
  },
  {
    id: 'fx.wind',
    titleKey: 'graph.inspector.generate.presets.frameAnimFx.wind',
    tab: 'fx',
    body: '2D 游戏风特效循环：半透明气流线从一侧扫过，卷起落叶与尘土，方向一致，持续循环'
  },
  {
    id: 'fx.dust',
    titleKey: 'graph.inspector.generate.presets.frameAnimFx.dust',
    tab: 'fx',
    body: '2D 游戏尘土特效：角色脚下扬起灰褐色尘土团，向两侧扩散并缓缓沉降，包含完整扬尘周期'
  },
  {
    id: 'fx.shockwave',
    titleKey: 'graph.inspector.generate.presets.frameAnimFx.shockwave',
    tab: 'fx',
    body: '2D 游戏冲击波特效：环形气浪从中心急速扩散，边缘高亮，伴随地面碎裂感，短促爆发'
  },
  {
    id: 'fx.glow',
    titleKey: 'graph.inspector.generate.presets.frameAnimFx.glow',
    tab: 'fx',
    body: '2D 游戏光效循环：柔和光晕由中心向外呼吸式明暗变化，边缘羽化，通透发光'
  },
  {
    id: 'fx.embers',
    titleKey: 'graph.inspector.generate.presets.frameAnimFx.embers',
    tab: 'fx',
    body: '2D 游戏火星余烬循环：细小火星从底部向上飘升，明灭闪烁，上升过程中逐渐熄灭'
  },
  {
    id: 'fx.bubbles',
    titleKey: 'graph.inspector.generate.presets.frameAnimFx.bubbles',
    tab: 'fx',
    body: '2D 游戏气泡特效：透明气泡从底部缓缓上升，表面反光，到达顶部破裂，包含完整周期'
  },
  {
    id: 'fx.slash',
    titleKey: 'graph.inspector.generate.presets.frameAnimFx.slash',
    tab: 'fx',
    body: '2D 游戏斩击特效：弧形刀光横扫，前段亮白后段拖尾，瞬间出现快速消失'
  },
  {
    id: 'fx.impact',
    titleKey: 'graph.inspector.generate.presets.frameAnimFx.impact',
    tab: 'fx',
    body: '2D 游戏打击特效：命中点爆出星形闪光与短促放射线条，向四周扩散，快速消失'
  },
  {
    id: 'fx.hit',
    titleKey: 'graph.inspector.generate.presets.frameAnimFx.hit',
    tab: 'fx',
    body: '2D 游戏命中受击特效序列：依次为命中瞬间白闪、放射状火花与碎屑飞溅、烟雾扩散、余烬消散，短促有力'
  },
  {
    id: 'fx.projectile',
    titleKey: 'graph.inspector.generate.presets.frameAnimFx.projectile',
    tab: 'fx',
    body: '2D 游戏投射物特效序列：能量弹从出现凝聚、加速飞行并拉出拖尾光迹、命中目标爆开并消散，包含完整发射周期'
  }
]

const SVG_GEN_PRESETS: InstructionPreset[] = [
  {
    id: 'icon.flat',
    titleKey: 'graph.inspector.generate.presets.svgGen.iconFlat',
    body: '扁平风格应用图标：单一主体居中，圆角几何造型，双色渐变，简洁明快，边缘干净无噪点'
  },
  {
    id: 'icon.badge',
    titleKey: 'graph.inspector.generate.presets.svgGen.iconBadge',
    body: '游戏道具徽章图标：外圈描边与高光，内部符号居中，深色底衬托，适合背包 / 技能图标'
  },
  {
    id: 'ui.loading',
    titleKey: 'graph.inspector.generate.presets.svgGen.uiLoading',
    body: '加载动效：圆环顺时针匀速旋转，柔和渐变，尾部渐隐，节奏平稳并可无缝循环'
  },
  {
    id: 'ui.button',
    titleKey: 'graph.inspector.generate.presets.svgGen.uiButton',
    body: 'UI 按钮：圆角矩形底板 + 内高光 + 轻微投影，中心留白放文字，配色与整体风格统一'
  },
  {
    id: 'anim.icon',
    titleKey: 'graph.inspector.generate.presets.svgGen.animIcon',
    body: '图标动效：主体上下轻浮动（或按压回弹），阴影随之缩放，无缝循环'
  },
  {
    id: 'illust.flat',
    titleKey: 'graph.inspector.generate.presets.svgGen.illustFlat',
    body: '扁平插画：几何色块构成场景，主体明确、构图留白，颜色数量控制在 5 种以内'
  }
]

const GAME_HTML_GEN_PRESETS: InstructionPreset[] = [
  {
    id: 'collect.2d',
    titleKey: 'graph.inspector.generate.presets.gameHtmlGen.collect2d',
    body: '2D 顶视收集小游戏：WASD / 方向键移动蓝球，收集 8 个黄点后胜利，按 R 重开'
  },
  {
    id: 'dodge.2d',
    titleKey: 'graph.inspector.generate.presets.gameHtmlGen.dodge2d',
    body: '2D 躲避小游戏：玩家左右移动躲开从上往下掉的障碍，坚持越久分越高，撞到即失败，R 重开'
  },
  {
    id: 'collect.3d',
    titleKey: 'graph.inspector.generate.presets.gameHtmlGen.collect3d',
    body: '3D 简易收集：WASD 在平面上移动方块角色，捡起周围黄块，全部收完胜利，R 重置'
  },
  {
    id: 'arena.3d',
    titleKey: 'graph.inspector.generate.presets.gameHtmlGen.arena3d',
    body: '3D 小竞技场：第三人称视角，WASD 移动，在平台上存活并碰到目标物得分，掉落出局，R 重开'
  }
]

/**
 * 3D 姿势节点常用预设：只当指令模板写入 generateInstruction，
 * 与自由描述同一条 dsh→Blender 通路。菜单标题走
 * `graph.inspector.generate.presets.modelPose.<id>`，chip 名称只显示动作主题。
 */
const MODEL_POSE_PRESETS: InstructionPreset[] = [
  {
    id: 'idle',
    titleKey: 'graph.inspector.generate.presets.modelPose.idle',
    body: '自然站立休息：重心略偏右腿，左膝微松；双臂自然垂于体侧，肩放松；脊柱直立，头略微前看，整体放松不僵硬。'
  },
  {
    id: 'walk',
    titleKey: 'graph.inspector.generate.presets.modelPose.walk',
    body: '走路迈步中段：右腿向前跨出、膝微屈，左腿在后且膝更屈；左臂前摆、右臂后摆；骨盆略向右前侧下沉，脊柱轻微扭转，目视前方。'
  },
  {
    id: 'run',
    titleKey: 'graph.inspector.generate.presets.modelPose.run',
    body: '跑步冲刺静帧：躯干明显前倾；右腿大步前跨、左腿后蹬膝高屈；左臂大幅前摆肘屈约90°，右臂后摆；头略低看前方，动态张力强。'
  },
  {
    id: 'jumpAir',
    titleKey: 'graph.inspector.generate.presets.modelPose.jumpAir',
    body: '跳跃腾空：双臂上扬或略后摆平衡；髋与双膝屈曲收腿，脚尖略下指；脊柱轻微伸展，胸部打开，面朝前上方，像刚离开地面。'
  },
  {
    id: 'jumpLand',
    titleKey: 'graph.inspector.generate.presets.modelPose.jumpLand',
    body: '跳跃落地缓冲：双脚着地感，双膝深度屈曲，髋后坐；躯干前倾，双臂前伸或侧开保持平衡；头前看，重心低稳。'
  },
  {
    id: 'wave',
    titleKey: 'graph.inspector.generate.presets.modelPose.wave',
    body: '右侧挥手致意：身体略转向右；右上臂外展抬起，右肘屈约40°–60°，右腕上扬作挥手；左臂自然下垂；重心偏左腿，表情面向观者。'
  },
  {
    id: 'handsOnHips',
    titleKey: 'graph.inspector.generate.presets.modelPose.handsOnHips',
    body: '双手叉腰站立：双脚略分开，重心稳；双手叉于腰侧，肘外展；胸稍挺，下巴微抬，自信站姿。'
  },
  {
    id: 'point',
    titleKey: 'graph.inspector.generate.presets.modelPose.point',
    body: '右手指向前方：右臂前伸指向正前方，肘微直；左臂自然垂或轻屈于体侧；躯干略跟右手方向扭转，目视所指方向。'
  },
  {
    id: 'think',
    titleKey: 'graph.inspector.generate.presets.modelPose.think',
    body: '托腮思考：重心偏一侧；右手抬至下颌/面颊轻托，右肘屈；左臂交叠或垂于身前；头略侧倾低头思考，肩放松。'
  },
  {
    id: 'crouch',
    titleKey: 'graph.inspector.generate.presets.modelPose.crouch',
    body: '深蹲警戒：双膝深屈、髋下沉，上身微前倾；双手可置于膝前或抬起防护；头抬起观察前方，重心低、随时可起身。'
  },
  {
    id: 'kneel',
    titleKey: 'graph.inspector.generate.presets.modelPose.kneel',
    body: '右膝单跪：右膝着地、左脚前撑；躯干直立或微前倾；双手可放在左膝上；头正视前方，稳定单跪姿势。'
  },
  {
    id: 'bow',
    titleKey: 'graph.inspector.generate.presets.modelPose.bow',
    body: '鞠躬致意：双脚并拢站稳；髋为轴上身前倾约30°–45°，脊柱连贯弯曲；双臂垂于体侧或身前；头随躯干低下，礼貌正式。'
  },
  {
    id: 'fightGuard',
    titleKey: 'graph.inspector.generate.presets.modelPose.fightGuard',
    body: '运动训练戒备站姿：左脚在前右脚在后，膝微屈；双手抬至下颌前方护面，肘内收；躯干略侧对前方，重心居中可移动，目光平视前方。'
  },
  {
    id: 'sit',
    titleKey: 'graph.inspector.generate.presets.modelPose.sit',
    body: '端坐姿势（无椅子也可表现坐姿感）：髋膝约90°屈曲，躯干直立；双手放在大腿上；双脚平放地面感，肩放松，头正直前视。'
  }
]

/**
 * 3D 模型拆分（智能分割）常用点名提示：写入 generateInstruction → `hint`，
 * 告诉上游「想拆出哪些部件」。网格分割不使用该框。
 */
const MODEL_SEGMENT_PRESETS: InstructionPreset[] = [
  {
    id: 'gameCharacter',
    titleKey: 'graph.inspector.generate.presets.modelSegment.gameCharacter',
    body: '带武器与护甲的游戏角色，把武器、护甲与身体各部位拆成独立部件'
  },
  {
    id: 'mechanical',
    titleKey: 'graph.inspector.generate.presets.modelSegment.mechanical',
    body: '机械载具：车体、车轮、炮塔、舱盖分别拆开'
  },
  {
    id: 'furniture',
    titleKey: 'graph.inspector.generate.presets.modelSegment.furniture',
    body: '家具：桌面、抽屉、柜门、支腿分别拆开'
  },
  {
    id: 'architecture',
    titleKey: 'graph.inspector.generate.presets.modelSegment.architecture',
    body: '建筑构件：屋顶、墙体、门窗、台阶分别拆开'
  },
  {
    id: 'cartoonPerson',
    titleKey: 'graph.inspector.generate.presets.modelSegment.cartoonPerson',
    body: '卡通角色：头、躯干、双臂、双腿、头发分别拆开'
  },
  {
    id: 'creature',
    titleKey: 'graph.inspector.generate.presets.modelSegment.creature',
    body: '生物：头部、躯干、四肢、尾巴、翅膀分别拆开'
  }
]

/**
 * 3D 动画重定向预设动作组合：写入 generateInstruction → `animations`。
 * 仅预设型供应商（Tripo `preset:xxx`）适用；动作库型（Meshy `action_id`）
 * 在卡片上会隐藏预设按钮，改用 Inspector 里的动作库选择器。
 */
const MODEL_RETARGET_PRESETS: InstructionPreset[] = [
  {
    id: 'walk',
    titleKey: 'graph.inspector.generate.presets.modelRetarget.walk',
    body: 'preset:walk'
  },
  {
    id: 'idleWalkRun',
    titleKey: 'graph.inspector.generate.presets.modelRetarget.idleWalkRun',
    body: 'preset:idle, preset:walk, preset:run'
  },
  {
    id: 'locomotionCombat',
    titleKey: 'graph.inspector.generate.presets.modelRetarget.locomotionCombat',
    body: 'preset:walk, preset:run, preset:slash, preset:shoot'
  },
  {
    id: 'hurtFall',
    titleKey: 'graph.inspector.generate.presets.modelRetarget.hurtFall',
    body: 'preset:hurt, preset:fall'
  },
  {
    id: 'turnJump',
    titleKey: 'graph.inspector.generate.presets.modelRetarget.turnJump',
    body: 'preset:turn, preset:jump'
  },
  {
    id: 'dance',
    titleKey: 'graph.inspector.generate.presets.modelRetarget.dance',
    body: 'preset:dance_01'
  }
]

/** 3D 贴图常用材质模板：写入 generateInstruction → `texturePromptText`（文生贴图） */
const MODEL_TEXTURE_PRESETS: InstructionPreset[] = [
  {
    id: 'wornLeather',
    titleKey: 'graph.inspector.generate.presets.modelTexture.wornLeather',
    body: '磨损皮革：表面有细密龟裂纹，边缘泛白起毛，缝线处略油亮，整体哑光。'
  },
  {
    id: 'brushedMetal',
    titleKey: 'graph.inspector.generate.presets.modelTexture.brushedMetal',
    body: '拉丝金属：细密单向拉丝纹理，倒角处高光，表面有轻微指纹与油渍，冷色反射。'
  },
  {
    id: 'agedWood',
    titleKey: 'graph.inspector.generate.presets.modelTexture.agedWood',
    body: '做旧木纹：年轮清晰，表面有划痕与磕碰缺口，边角磨损露底色，哑光清漆。'
  },
  {
    id: 'ceramic',
    titleKey: 'graph.inspector.generate.presets.modelTexture.ceramic',
    body: '陶瓷釉面：釉层光滑带细微开片，边缘有积釉，高光柔和，色彩均匀。'
  },
  {
    id: 'fabric',
    titleKey: 'graph.inspector.generate.presets.modelTexture.fabric',
    body: '织物：经纬编织纹理可见，带细微绒毛与自然褶皱，颜色深浅略有变化，完全哑光。'
  },
  {
    id: 'cartoonFlat',
    titleKey: 'graph.inspector.generate.presets.modelTexture.cartoonFlat',
    body: '卡通平涂：大块纯色，无写实纹理与噪点，色块边缘干净，轻微手绘描边。'
  },
  {
    id: 'cyberpunk',
    titleKey: 'graph.inspector.generate.presets.modelTexture.cyberpunk',
    body: '赛博朋克：深色基底 + 霓虹紫青高光，面板接缝发光，表面有磨损与贴纸残迹。'
  },
  {
    id: 'stone',
    titleKey: 'graph.inspector.generate.presets.modelTexture.stone',
    body: '石材：颗粒感明显，天然色斑与细裂纹，边缘风化圆钝，哑光吸光。'
  },
  {
    id: 'wetSurface',
    titleKey: 'graph.inspector.generate.presets.modelTexture.wetSurface',
    body: '湿润表面：整体覆盖薄水膜，边缘挂水珠，反射增强，暗部压深。'
  },
  {
    id: 'glass',
    titleKey: 'graph.inspector.generate.presets.modelTexture.glass',
    body: '玻璃：高透光，厚度处偏绿，表面有细微划痕与灰尘，高光锐利。'
  }
]

/**
 * 3D 骨骼蒙皮常用预设：写入 generateInstruction，并与骨架类型选择对齐（云端 Rigging API）。
 */
const MODEL_RIG_SKIN_PRESETS: InstructionPreset[] = [
  {
    id: 'humanoid-simple',
    titleKey: 'graph.inspector.generate.presets.modelRigSkin.humanoidSimple',
    body: 'humanoid'
  },
  {
    id: 'humanoid-mixamo',
    titleKey: 'graph.inspector.generate.presets.modelRigSkin.humanoidMixamo',
    body: 'humanoid'
  },
  {
    id: 'quadruped',
    titleKey: 'graph.inspector.generate.presets.modelRigSkin.quadruped',
    body: 'quadruped'
  },
  {
    id: 'prop-rigid',
    titleKey: 'graph.inspector.generate.presets.modelRigSkin.propRigid',
    body: 'creature'
  }
]

/**
 * 3D 动画常用预设：只当指令模板写入 generateInstruction，
 * 与自由描述同一条 dsh→Blender 通路。
 * 16 个 id 与 modelPose 重复但 body 不同——姿势是静帧、动画是循环/关键帧。
 * 14–16（hitReact/death/celebrate）为游戏特化的反馈/结局循环。
 */
const MODEL_ANIMATION_PRESETS: InstructionPreset[] = [
  {
    id: 'idle',
    titleKey: 'graph.inspector.generate.presets.modelAnimation.idle',
    body: '循环待机动画：身体轻微起伏、双手小摆、头微动，整体放松，24 fps，约 30 帧无缝循环。'
  },
  {
    id: 'walk',
    titleKey: 'graph.inspector.generate.presets.modelAnimation.walk',
    body: '走路循环：四肢对侧摆、髋部上下/侧倾，24 fps，24 帧（一步半）无缝循环。'
  },
  {
    id: 'run',
    titleKey: 'graph.inspector.generate.presets.modelAnimation.run',
    body: '跑步循环：明显前倾、双臂高摆、双腿大幅摆动，24 fps，20 帧无缝循环。'
  },
  {
    id: 'jumpAir',
    titleKey: 'graph.inspector.generate.presets.modelAnimation.jumpAir',
    body: '跳跃腾空帧：双臂上扬平衡、髋膝收腿，18 帧静帧姿态（适合补到 jumpLand 之前）。'
  },
  {
    id: 'jumpLand',
    titleKey: 'graph.inspector.generate.presets.modelAnimation.jumpLand',
    body: '跳跃落地缓冲：双膝深屈、髋后坐、双臂前伸，18 帧静帧姿态。'
  },
  {
    id: 'wave',
    titleKey: 'graph.inspector.generate.presets.modelAnimation.wave',
    body: '右手挥手循环：右上臂高摆+右腕来回摆，36 帧无缝循环。'
  },
  {
    id: 'handsOnHips',
    titleKey: 'graph.inspector.generate.presets.modelAnimation.handsOnHips',
    body: '双手叉腰站立循环：双手叉腰、肘外摆、胸微挺，24 帧轻微摆动。'
  },
  {
    id: 'think',
    titleKey: 'graph.inspector.generate.presets.modelAnimation.think',
    body: '思考托腮循环：右手托下颌、头略低垂、轻微左右偏头，36 帧。'
  },
  {
    id: 'crouch',
    titleKey: 'graph.inspector.generate.presets.modelAnimation.crouch',
    body: '深蹲戒备循环：双膝深屈、重心低、双臂抬前护面，24 帧轻微起伏。'
  },
  {
    id: 'kneel',
    titleKey: 'graph.inspector.generate.presets.modelAnimation.kneel',
    body: '单膝跪姿静帧：右膝着地、左脚前撑，24 帧轻微呼吸起伏。'
  },
  {
    id: 'bow',
    titleKey: 'graph.inspector.generate.presets.modelAnimation.bow',
    body: '鞠躬致意静帧：髋为轴上身前倾、脊柱连贯弯曲，30 帧（弯腰 + 短暂停顿）。'
  },
  {
    id: 'fightGuard',
    titleKey: 'graph.inspector.generate.presets.modelAnimation.fightGuard',
    body: '运动训练戒备站姿循环：双肘抬起护面、膝微屈，20 帧轻微摆动。'
  },
  {
    id: 'sit',
    titleKey: 'graph.inspector.generate.presets.modelAnimation.sit',
    body: '端坐静帧：髋膝约 90° 屈曲、躯干直立，24 帧呼吸起伏。'
  },
  {
    id: 'hitReact',
    titleKey: 'graph.inspector.generate.presets.modelAnimation.hitReact',
    body: '命中受击短循环：上身受击后仰 1–2 帧、双臂回收护体、重心微降，24 fps，16 帧（连续受击反馈用）。'
  },
  {
    id: 'death',
    titleKey: 'graph.inspector.generate.presets.modelAnimation.death',
    body: '倒地死亡：膝先软、髋下坐、再翻倒侧卧，36 帧，末帧静帧（用于击倒/击杀反馈）。'
  },
  {
    id: 'celebrate',
    titleKey: 'graph.inspector.generate.presets.modelAnimation.celebrate',
    body: '胜利庆祝循环：双臂上举握拳/挥手、原地小幅跳跃，24 fps，24 帧无缝循环（关卡通关/任务完成）。'
  }
]

/**
 * 空间世界常用预设：只当指令模板写入 generateInstruction。
 * 世界生成吃的是「空间 + 起始视角景物」，与 3D 单体资产的描述口径不同，故单独成套。
 */
const WORLD_MODEL_PRESETS: InstructionPreset[] = [
  {
    id: 'interior',
    titleKey: 'graph.inspector.generate.presets.spatialWorld.interior',
    tab: 'general',
    body: '一间温暖的中世纪木屋室内：起始视角站在门口向内看，可见壁炉、木桌、吊灯与窗外雪景，暖黄烛光为主光源，木质与织物材质细节清晰，写实风格。'
  },
  {
    id: 'outdoor',
    titleKey: 'graph.inspector.generate.presets.spatialWorld.outdoor',
    tab: 'general',
    body: '一片开阔的山谷户外场景：起始视角在草坡上，可见远处雪山、蜿蜒溪流、成片针叶林与散落的巨石，午后偏暖阳光、体积光穿过树冠，写实自然风格。'
  },
  {
    id: 'stylized',
    titleKey: 'graph.inspector.generate.presets.spatialWorld.stylized',
    tab: 'general',
    body: '风格化卡通小镇广场：低多边形建筑围绕中央喷泉，色彩明快饱和，边缘干净、材质简化，明亮日光与柔和阴影，适合游戏关卡漫游。'
  },
  {
    id: 'scifi',
    titleKey: 'graph.inspector.generate.presets.spatialWorld.scifi',
    tab: 'fx',
    body: '未来感空间站内部走廊：起始视角面向环形舷窗，可见金属舱壁、管线、指示灯与舱外行星，冷蓝主光加暖色点缀，硬表面材质与柔和反射，科幻写实风格。'
  }
]

const PRESET_PACKS: Record<InstructionPresetKind, InstructionPreset[]> = {
  screenplay: SCREENPLAY_PRESETS,
  gameSystem: GAME_SYSTEM_PRESETS,
  image: IMAGE_PRESETS,
  video: VIDEO_PRESETS,
  lipSync: LIP_SYNC_PRESETS,
  reshoot: RESHOOT_PRESETS,
  voice: VOICE_PRESETS,
  toPrompt: TO_PROMPT_PRESETS,
  optimize: OPTIMIZE_PRESETS,
  spatialWorldExtract: WORLD_EXTRACT_PRESETS,
  beatSplit: BEAT_SPLIT_PRESETS,
  // 规则在系统提示词；指令窗口仅作临时焦点，暂无成套预设
  beatUnitGen: [],
  uiSplit: [],
  frameAnimGen: [...FRAME_ANIM_GEN_CHARACTER_PRESETS, ...FRAME_ANIM_GEN_FX_PRESETS],
  svgGen: SVG_GEN_PRESETS,
  gameHtmlGen: GAME_HTML_GEN_PRESETS,
  model3d: [],
  spatialWorld: WORLD_MODEL_PRESETS,
  modelPose: MODEL_POSE_PRESETS,
  modelRigSkin: MODEL_RIG_SKIN_PRESETS,
  // 拆分节点的指令框是智能分割的部件点名提示
  modelSegment: MODEL_SEGMENT_PRESETS,
  // 部件补全 / 重拓扑 / 转换的指令框写「上游部件名」（从部件选择器点选更准），绑骨检查无输入
  modelMeshComplete: [],
  modelRetopology: [],
  modelRigCheck: [],
  modelConvert: [],
  modelRetarget: MODEL_RETARGET_PRESETS,
  modelTexture: MODEL_TEXTURE_PRESETS,
  modelAnimation: MODEL_ANIMATION_PRESETS,
  mediaReview: [],
  mediaRework: []
}

export function listInstructionPresets(kind: InstructionPresetKind): InstructionPreset[] {
  return PRESET_PACKS[kind] ?? []
}

export function getInstructionPreset(
  kind: InstructionPresetKind,
  id: string
): InstructionPreset | undefined {
  return listInstructionPresets(kind).find((item) => item.id === id)
}

/** 该 kind 下实际出现的页签（按固定顺序）；少于 2 个则 UI 不显示页签栏 */
export function listInstructionPresetTabs(kind: InstructionPresetKind): InstructionPresetTab[] {
  const present = new Set<InstructionPresetTab>()
  for (const item of listInstructionPresets(kind)) {
    if (item.tab) present.add(item.tab)
  }
  return INSTRUCTION_PRESET_TAB_ORDER.filter((tab) => present.has(tab))
}

export function listInstructionPresetsByTab(
  kind: InstructionPresetKind,
  tab: InstructionPresetTab | null
): InstructionPreset[] {
  const all = listInstructionPresets(kind)
  if (!tab) return all
  return all.filter((item) => (item.tab ?? 'general') === tab)
}
