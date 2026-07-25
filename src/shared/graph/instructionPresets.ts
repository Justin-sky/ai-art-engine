/**
 * 生成指令预设：按用途分套（含图片反推提示词 / 提示词优化）。
 *
 * 剧本模板由「短剧提示词」原稿提炼而来，保留结构槽位与硬约束，去掉例文堆砌。
 */

export type InstructionPresetKind =
  | 'screenplay'
  | 'image'
  | 'video'
  | 'lipSync'
  | 'voice'
  | 'toPrompt'
  | 'optimize'
  | 'shotSplit'
  | 'worldExtract'
  | 'narrativeSplit'

export interface InstructionPreset {
  id: string
  /** i18n 标题 key */
  titleKey: string
  /** 写入生成指令框的正文 */
  body: string
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

/** 场景提示词优化 */
const OPTIMIZE_SCENE_BODY = `你是一位专业的 AI 短剧场景提示词工程师，专门为AI工具生成高质量的场景提示词。
请你根据我提供的场景描述，生成一段符合 LibTV 要求的场景提示词。
提示词需要包含以下几个部分：
1. 风格和画质要求：虚幻引擎UE5建模风格，高精度建模渲染，8K超清分辨率，电影级光影效果，真实材质质感，无人物，无文字，无水印
2. 基本信息：场景名称、时代背景、时间、天气、环境氛围
3. 详细布局：场景的整体布局、主要建筑、道具的位置和描述
4. 光影和色彩：光影效果、主色调、氛围营造
5. 质量要求：透视正确，比例协调，细节丰富，光影统一

请你生成的提示词简洁明了，重点突出，不要有多余的内容。
现在，请你为我生成以下场景的提示词：`

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

/** 多机位九宫格 */
const IMAGE_MULTI_ANGLE_9_BODY = `基于当前参考图，生成一张「多机位九宫格」拼图。
要求：
1. 约 9 个不同机位/景别视角（如大特写、特写、半身、中景、全景、仰拍、俯拍、侧拍、过肩等），均匀排布为 3×3 九宫格
2. 保持同一主体、服装、气质与场景风格一致，仅改变机位、景别与构图
3. 支持并尽量发挥模型可用的图像分辨率能力，画面清晰、边缘整齐、无错位拼接感
4. 白边分隔清晰，每格独立成幅，无文字水印

请直接输出九宫格图像。`

/** 剧情推演四宫格 */
const IMAGE_STORY_4_BODY = `基于当前参考图，生成一张「剧情推演四宫格」拼图。
要求：
1. 2×2 四宫格，按时间顺序推演后续剧情（起→承→转→合）
2. 角色身份、服装与场景逻辑连贯，动作与情绪递进自然
3. 支持文生或参考图生成：有参考图时保持主体一致；可结合指令中的文本补充剧情
4. 分格清晰，电影分镜感，无文字水印

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

/** 场景设定图 */
const IMAGE_SCENE_SHEET_BODY = `基于当前参考图，生成完整的「场景设定图」。
要求：
1. 交代空间结构、主视角、材质与氛围光影，可含局部细节特写
2. 与参考场景风格一致，可扩展为可制作的场景设定
3. 支持通过文本/参考图补充场景元素
4. 构图清晰，无多余人物干扰（除非场景需要），无文字水印

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
1. 将场景扩展/转换为可环视的 720° 全景（或等价全向环境贴图构图），空间连续、透视自然
2. 保持原场景风格、材质与光影氛围一致，补全未见区域时需合理、可衔接
3. 支持文生或参考图生成：有参考图时以场景为主体；可结合文本补充环境细节
4. 输出适合全景浏览的单张全景图，无文字水印、无明显接缝撕裂

请直接输出 720 全景图。`

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

const IMAGE_PRESETS: InstructionPreset[] = [
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

const VOICE_PRESETS: InstructionPreset[] = []
const TO_PROMPT_PRESETS: InstructionPreset[] = []
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
  }
]

/** 剧本拆分为分镜表（输出由系统提示词约束为表格 JSON） */
const SHOT_SPLIT_CREATE_BODY = `请将下列剧本拆分为分镜，并严格按系统提示词规定的 JSON 数组格式输出（字段：title、durationSec、visualDescription、shotSize、lighting、dialogue、soundFx、cameraMove、status）。
要求：按叙事顺序；景别只能用 大特写/特写/半身景/中景/中远景/全景/远景；时长 1–60 秒；status 默认「未审核」；只输出 JSON。

剧本内容：`

/** 优化已有分镜节奏（仍须输出同一 JSON 格式） */
const SHOT_SPLIT_REFINE_BODY = `请优化下列分镜列表的镜头节奏与表达，并严格按系统提示词规定的 JSON 数组格式重新输出（字段不变）。
要求：合并冗余、拆分过长镜头；景别与运镜更清晰可执行；保留剧情与台词含义；status 为「已审核」的行必须原样保留、不得修改；只输出 JSON。

分镜内容：`

const SHOT_SPLIT_PRESETS: InstructionPreset[] = [
  {
    id: 'shotSplit.create',
    titleKey: 'graph.inspector.generate.presets.shotSplit.create',
    body: SHOT_SPLIT_CREATE_BODY
  },
  {
    id: 'shotSplit.refine',
    titleKey: 'graph.inspector.generate.presets.shotSplit.refine',
    body: SHOT_SPLIT_REFINE_BODY
  }
]

const WORLD_EXTRACT_CREATE_BODY = `请从下列文本提取世界元素目录，并严格按系统提示词规定的 JSON 对象格式输出（顶层：characters / scenes / props / weapons；每项含 id、name、prompt、status）。
要求：
1. 只输出 JSON；空类用 []；顶层键不得增减。
2. 分类边界清晰：角色 / 场景 / 道具 / 武器；服装外观写进角色，勿重复拆条；兵器归 weapons，非武器互动物件归 props。
3. 合并同名异称；id 用稳定英文 slug。
4. prompt 必须可直接生图：主体外观、材质、光影、构图与类型片风格；禁止剧情摘要与对白。
5. 硬性构图：角色=正面朝镜头+纯色背景（禁止环境/场景）；场景=空无一人（禁止任何人物）；道具/武器=纯色底产品照（禁止环境背景）。
6. status 新项填「未审核」；若输入已有「已审核」项必须原样保留。
7. 宁缺毋滥，优先有辨识度的可复用元素。

文本内容：`

const WORLD_EXTRACT_REFINE_BODY = `请优化下列世界元素目录，并严格按系统提示词规定的 JSON 对象格式重新输出（顶层键与字段不变）。
要求：
1. 合并重复项，修正错误分类（角色/场景/道具/武器）。
2. 强化每条 prompt 的外观、材质、光影、构图细节，使其更适合稳定生图。
3. 按硬性规范改写：角色正面纯色底无环境；场景去掉所有人物；道具/武器去掉场景背景改为纯色产品照。
4. 保留已有合理 id；仅在明显冲突时调整。
5. status 为「已审核」的项必须原样保留、不得修改。
6. 只输出 JSON。

目录内容：`

const WORLD_EXTRACT_PRESETS: InstructionPreset[] = [
  {
    id: 'worldExtract.create',
    titleKey: 'graph.inspector.generate.presets.worldExtract.create',
    body: WORLD_EXTRACT_CREATE_BODY
  },
  {
    id: 'worldExtract.refine',
    titleKey: 'graph.inspector.generate.presets.worldExtract.refine',
    body: WORLD_EXTRACT_REFINE_BODY
  }
]

const NARRATIVE_SPLIT_CREATE_BODY = `请将下列剧本拆解为叙事单元，并严格按系统提示词规定的 JSON 数组格式输出。
硬性要求：
1. 粒度是场/节拍（一个单元≈后续多镜），禁止景别/运镜/构图。
2. 按故事顺序覆盖全文；同目标、同地点、同情绪的连续微动作合并；遇换场、时间跳跃、不可逆揭露、冲突升级、抉择、情绪转向再拆。
3. summary 写清「谁做了什么→什么变化」；sourceExcerpt 紧贴原文定位，不要写成第二份摘要。
4. dramaticFunction 只能是 建置|冲突|转折|高潮|收束|过渡；durationHint 优先 短|中|长；新建 status=未审核。
5. 只输出 JSON。

剧本内容：`

const NARRATIVE_SPLIT_REFINE_BODY = `请优化下列叙事单元列表，并严格按系统提示词规定的 JSON 数组格式重新输出（字段集合不变）。
硬性要求：
1. 合并过碎单元、拆分过长或功能混杂的单元；戏剧功能判定更准确。
2. 强化 summary / emotionalBeat / sourceExcerpt 的信息密度与可定位性；地点与角色名前后一致。
3. 禁止改成镜头语言；禁止编造原文没有的情节。
4. status 为「已审核」的单元必须原样保留、不得修改。
5. 只输出 JSON。

叙事单元内容：`

const NARRATIVE_SPLIT_PRESETS: InstructionPreset[] = [
  {
    id: 'narrativeSplit.create',
    titleKey: 'graph.inspector.generate.presets.narrativeSplit.create',
    body: NARRATIVE_SPLIT_CREATE_BODY
  },
  {
    id: 'narrativeSplit.refine',
    titleKey: 'graph.inspector.generate.presets.narrativeSplit.refine',
    body: NARRATIVE_SPLIT_REFINE_BODY
  }
]

const PRESET_PACKS: Record<InstructionPresetKind, InstructionPreset[]> = {
  screenplay: SCREENPLAY_PRESETS,
  image: IMAGE_PRESETS,
  video: VIDEO_PRESETS,
  lipSync: LIP_SYNC_PRESETS,
  voice: VOICE_PRESETS,
  toPrompt: TO_PROMPT_PRESETS,
  optimize: OPTIMIZE_PRESETS,
  shotSplit: SHOT_SPLIT_PRESETS,
  worldExtract: WORLD_EXTRACT_PRESETS,
  narrativeSplit: NARRATIVE_SPLIT_PRESETS
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
