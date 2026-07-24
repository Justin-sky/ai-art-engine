import type { ShotStoryboard } from '../domain'

export type ShotStagingGroup =
  'cameraLanguage' | 'bodyFacing' | 'performance' | 'lighting' | 'advertising'

export type ShotStagingTextField = 'visualDescription' | 'lighting' | 'cameraMove'

export interface LocalizedText {
  zh: string
  en: string
}

export interface ShotStagingPreset {
  id: string
  group: ShotStagingGroup
  titleKey: string
  shotSize?: string
  visualDescription?: LocalizedText
  lighting?: LocalizedText
  cameraMove?: LocalizedText
}

const text = (zh: string, en: string): LocalizedText => ({ zh, en })

/**
 * 电影镜头调度骨架。
 * 这些条目提炼通用摄影方法，不包含教程中的人物、品牌或完整示例正文。
 */
export const SHOT_STAGING_PRESETS: readonly ShotStagingPreset[] = [
  {
    id: 'camera.heroEntrance',
    group: 'cameraLanguage',
    titleKey: 'shot.staging.preset.heroEntrance',
    shotSize: '全景',
    visualDescription: text(
      '低机位仰拍，@1 从 @2 中进入画面；先用局部细节建立悬念，再逐步露出全身与坚定神态。',
      'Low-angle view: @1 enters through @2. Begin on a revealing detail, then gradually reveal the full figure and a determined expression.'
    ),
    lighting: text(
      '强轮廓逆光，空气中可见尘雾或体积光，史诗氛围',
      'Strong rim backlight with visible haze or volumetric light; epic mood'
    ),
    cameraMove: text(
      '从局部特写缓慢上摇并推进，经中景落到面部特写',
      'Slow tilt-up and push-in from a detail, through a medium shot, ending on a facial close-up'
    )
  },
  {
    id: 'camera.mysteriousEntrance',
    group: 'cameraLanguage',
    titleKey: 'shot.staging.preset.mysteriousEntrance',
    shotSize: '中景',
    visualDescription: text(
      '从 @1 的背影或被前景遮挡的局部开始，人物进入 @2；面部信息延迟揭示，保持压迫与悬念。',
      'Begin behind @1 or through a foreground obstruction as the subject enters @2. Delay the facial reveal to preserve pressure and suspense.'
    ),
    lighting: text(
      '高反差暗调，人物从明处走入阴影，环境微尘可见',
      'High-contrast low-key light; subject moves from light into shadow with subtle airborne dust'
    ),
    cameraMove: text(
      '轻微手持缓慢跟进，沿身体上移后绕至四分之三侧面',
      'Subtle handheld slow follow; travel upward along the body and arc to a three-quarter angle'
    )
  },
  {
    id: 'camera.storyEntrance',
    group: 'cameraLanguage',
    titleKey: 'shot.staging.preset.storyEntrance',
    shotSize: '中景',
    visualDescription: text(
      '@1 在 @2 中自然行动，人物与环境保持清晰空间关系，动作透露其处境和性格。',
      '@1 acts naturally in @2, with a clear spatial relationship between subject and environment; behavior reveals situation and character.'
    ),
    cameraMove: text(
      '平视手持跟拍并做缓慢小幅环绕，运动带轻微呼吸感',
      'Eye-level handheld tracking with a slow shallow orbit and subtle human breathing motion'
    )
  },
  {
    id: 'camera.twoShot',
    group: 'cameraLanguage',
    titleKey: 'shot.staging.preset.twoShot',
    shotSize: '中景',
    visualDescription: text(
      '@1 与第二人物处于同一画面，站位错落且视线关系明确，环境信息辅助交代双方关系。',
      '@1 and the second character share the frame with staggered blocking and a clear eyeline; the environment supports their relationship.'
    ),
    cameraMove: text(
      '稳定机位或极缓慢推进，优先保留双人互动和空间关系',
      'Locked camera or a very slow push-in, prioritizing interaction and spatial continuity'
    )
  },
  {
    id: 'camera.overShoulder',
    group: 'cameraLanguage',
    titleKey: 'shot.staging.preset.overShoulder',
    shotSize: '半身景',
    visualDescription: text(
      '过肩反打（OTS）：前景保留一名人物虚化的肩部轮廓，焦点落在 @1 的面部，保持正确视线方向。',
      'Over-the-shoulder reverse shot (OTS): keep a soft shoulder silhouette in the foreground and focus on @1, preserving the eyeline.'
    ),
    cameraMove: text(
      '固定或轻微推进，切换反打时遵守轴线与视线匹配',
      'Locked or slight push-in; preserve screen direction and eyeline across the reverse angle'
    )
  },
  {
    id: 'camera.highEmotion',
    group: 'cameraLanguage',
    titleKey: 'shot.staging.preset.highEmotion',
    shotSize: '中远景',
    visualDescription: text(
      '高机位俯拍 @1，人物在环境中显得渺小；构图保留大面积负空间，表现无助与被压制。',
      'High-angle view of @1, making the subject small within the environment; use broad negative space to convey helplessness and pressure.'
    ),
    cameraMove: text(
      '从平视缓慢升高并转为俯视，情绪逐步下沉',
      'Slowly rise from eye level into a high angle as the emotional weight deepens'
    )
  },
  {
    id: 'camera.backEmotion',
    group: 'cameraLanguage',
    titleKey: 'shot.staging.preset.backEmotion',
    shotSize: '中远景',
    visualDescription: text(
      '从背面拍摄 @1，让观众与人物共同面对 @2；人物偏离中心并保留前方未知空间，强调孤独与疏离。',
      'Film @1 from behind so the audience faces @2 with the subject; place the subject off-center with unknown space ahead to emphasize isolation.'
    ),
    cameraMove: text(
      '缓慢跟随或静止观察，不抢先揭示人物正脸',
      'Slow follow or locked observation; do not reveal the face prematurely'
    )
  },
  {
    id: 'camera.dutch',
    group: 'cameraLanguage',
    titleKey: 'shot.staging.preset.dutch',
    shotSize: '中景',
    visualDescription: text(
      '荷兰角（Dutch angle）倾斜构图，垂直线明显失衡，@1 与环境产生不稳定关系。',
      'Dutch-angle composition with visibly tilted verticals, creating an unstable relationship between @1 and the environment.'
    ),
    cameraMove: text(
      '轻微不稳定推近，可在关键情绪点进一步倾斜画面',
      'A subtly unstable push-in, increasing the tilt at the emotional beat'
    )
  },
  {
    id: 'facing.front',
    group: 'bodyFacing',
    titleKey: 'shot.staging.preset.facingFront',
    shotSize: '半身景',
    visualDescription: text(
      '严格全正面拍摄 @1，眼神看向镜头；面部情绪直接可读，手部在画面下方做细微且有动机的动作。',
      'Film @1 strictly front-on with eyes toward camera; keep the facial emotion readable and include a small motivated hand action low in frame.'
    )
  },
  {
    id: 'facing.threeQuarter',
    group: 'bodyFacing',
    titleKey: 'shot.staging.preset.facingThreeQuarter',
    shotSize: '半身景',
    visualDescription: text(
      '45度正面（三分之四侧面）拍摄 @1，兼顾面部表情与身体立体感；加入视线扫动、手指动作或重心转移。',
      'Film @1 at a front three-quarter angle, balancing facial expression and body volume; add an eye scan, finger action, or weight shift.'
    )
  },
  {
    id: 'facing.profile',
    group: 'bodyFacing',
    titleKey: 'shot.staging.preset.facingProfile',
    shotSize: '特写',
    visualDescription: text(
      '纯侧面拍摄 @1，人物视线专注于画外目标而非镜头；轮廓清晰，观众处于旁观位置。',
      'Film @1 in pure profile, focused on an off-screen target rather than camera; keep the silhouette clear and the audience observational.'
    )
  },
  {
    id: 'facing.backThreeQuarter',
    group: 'bodyFacing',
    titleKey: 'shot.staging.preset.facingBackThreeQuarter',
    shotSize: '半身景',
    visualDescription: text(
      '45度背面拍摄 @1，前景加入轻微遮挡，人物只露出少量侧脸与动作线索，形成窥视和疏离感。',
      'Film @1 from a rear three-quarter angle with a soft foreground obstruction; reveal only a hint of profile and action for a voyeuristic, distant feeling.'
    )
  },
  {
    id: 'facing.back',
    group: 'bodyFacing',
    titleKey: 'shot.staging.preset.facingBack',
    shotSize: '中远景',
    visualDescription: text(
      '严格背面拍摄 @1，让人物与观众共同望向 @2；用肩线、头部偏转、手部动作和重心变化传递情绪，不提前露出正脸。',
      'Film @1 strictly from behind so the character and audience face @2 together; convey emotion through the shoulders, head turn, hands, and weight shift without revealing the face early.'
    )
  },
  {
    id: 'performance.anger',
    group: 'performance',
    titleKey: 'shot.staging.preset.performanceAnger',
    visualDescription: text(
      '@1 先短暂疑惑地皱眉，随后唇角紧抿、眉间收紧、鼻翼翕张，下颌与肩颈逐渐绷紧。',
      '@1 first frowns in brief confusion, then presses the lips, draws the brows together, flares the nostrils, and gradually tenses the jaw and shoulders.'
    )
  },
  {
    id: 'performance.dazed',
    group: 'performance',
    titleKey: 'shot.staging.preset.performanceDazed',
    visualDescription: text(
      '@1 的瞳孔焦距逐渐涣散，眨眼变慢，嘴唇微张；身体失去支撑感，肩膀下沉，可有一滴泪无意识滑落。',
      '@1 gradually loses eye focus, blinks more slowly, and parts the lips; the body loses support, shoulders sink, and a tear may slip out involuntarily.'
    )
  },
  {
    id: 'performance.manic',
    group: 'performance',
    titleKey: 'shot.staging.preset.performanceManic',
    visualDescription: text(
      '@1 快速眨眼并露出神经质笑容，嘴角和面部肌肉轻微抽动；突然大幅歪头，发丝随动作甩动，眼神瞬间锁定镜头。',
      '@1 blinks rapidly with a nervous grin and subtle facial twitches; suddenly tilts the head sharply, hair following the motion, and snaps the gaze onto camera.'
    ),
    cameraMove: text(
      '在眼神锁定时加入一次短促、不稳定的微推镜',
      'Add a brief unstable micro push-in when the gaze locks'
    )
  },
  {
    id: 'performance.relief',
    group: 'performance',
    titleKey: 'shot.staging.preset.performanceRelief',
    visualDescription: text(
      '@1 的眉头逐渐舒展，长舒一口气并微微仰头，肩膀与手指从紧绷过渡到放松。',
      '@1 gradually relaxes the brow, exhales deeply, lifts the chin slightly, and releases tension from the shoulders and fingers.'
    )
  },
  {
    id: 'performance.anxiety',
    group: 'performance',
    titleKey: 'shot.staging.preset.performanceAnxiety',
    visualDescription: text(
      '@1 眉头轻锁，视线在画外目标之间快速扫动；手指反复摩挲或按动手中物件，呼吸变浅，身体不耐烦地转换重心。',
      '@1 lightly knits the brows and scans quickly between off-screen targets; fingers repeatedly rub or click an object, breathing turns shallow, and body weight shifts impatiently.'
    )
  },
  {
    id: 'performance.grief',
    group: 'performance',
    titleKey: 'shot.staging.preset.performanceGrief',
    visualDescription: text(
      '@1 先屏住呼吸，眼眶逐渐湿润但不立即落泪；下颌微颤，嘴唇试图抿紧，胸口塌下，双手失去原本的力量。',
      '@1 first holds the breath as the eyes gradually well without immediately crying; the jaw trembles, lips try to press together, the chest collapses, and the hands lose strength.'
    )
  },
  {
    id: 'performance.confidence',
    group: 'performance',
    titleKey: 'shot.staging.preset.performanceConfidence',
    visualDescription: text(
      '@1 目光稳定锁定目标，眨眼减少，唇角仅轻微上扬；肩背打开、下颌保持水平，动作从容且没有多余摆动。',
      '@1 holds a steady gaze with fewer blinks and only a slight lift at the mouth; shoulders open, chin stays level, and movements remain deliberate without excess motion.'
    )
  },
  {
    id: 'performance.surprise',
    group: 'performance',
    titleKey: 'shot.staging.preset.performanceSurprise',
    visualDescription: text(
      '@1 先在动作中短暂停住，瞳孔迅速聚焦，眉毛抬起、嘴唇微张；随后上身轻微后撤，手指收紧，再决定下一步反应。',
      '@1 briefly freezes mid-action, snaps the eyes into focus, raises the brows, and parts the lips; the torso then recoils slightly and fingers tighten before the next response.'
    )
  },
  {
    id: 'lighting.top',
    group: 'lighting',
    titleKey: 'shot.staging.preset.lightingTop',
    lighting: text(
      '垂直顶光，眼窝处形成明显阴影，目光部分隐藏；背景暗调，压迫、神秘、冷酷',
      'Vertical top light casting deep eye-socket shadows and partly concealing the gaze; dark background, oppressive and mysterious'
    )
  },
  {
    id: 'lighting.side',
    group: 'lighting',
    titleKey: 'shot.staging.preset.lightingSide',
    lighting: text(
      '正侧硬光，主光从画外一侧照入，脸部一半清晰、一半处于阴影，高反差戏剧感',
      'Hard side key from off-screen, leaving one half of the face clear and the other in shadow; high-contrast dramatic mood'
    )
  },
  {
    id: 'lighting.rembrandt',
    group: 'lighting',
    titleKey: 'shot.staging.preset.lightingRembrandt',
    lighting: text(
      '伦勃朗光：主光位于人物侧前方约45度并略高于眼睛，暗侧脸颊保留小块倒三角亮区，深邃但仍可读',
      'Rembrandt lighting: key about 45 degrees to the front-side and slightly above eye level, leaving a small inverted triangle of light on the shadow-side cheek'
    )
  },
  {
    id: 'lighting.volumetric',
    group: 'lighting',
    titleKey: 'shot.staging.preset.lightingVolumetric',
    lighting: text(
      '有方向的体积光穿过薄雾、尘埃或水汽形成可见光束；主体受光边缘清晰，前中后景层次分明',
      'Directional volumetric light cuts through haze, dust, or vapor as visible beams; crisp lit edges and clear foreground, midground, and background separation'
    )
  },
  {
    id: 'lighting.backlight',
    group: 'lighting',
    titleKey: 'shot.staging.preset.lightingBacklight',
    lighting: text(
      '逆光或侧逆光从人物后方照入，勾勒发丝、肩部和产品边缘；正面仅保留克制补光，可出现有动机的光晕',
      'Backlight or rear three-quarter light outlines hair, shoulders, and product edges; restrained frontal fill with motivated flare'
    )
  },
  {
    id: 'lighting.practical',
    group: 'lighting',
    titleKey: 'shot.staging.preset.lightingPractical',
    lighting: text(
      '画面内可见灯具、窗户、屏幕或霓虹作为有动机光源，人物受光方向与环境光源一致，色温有层次但不过度染色',
      'Use visible lamps, windows, screens, or neon as motivated sources; subject lighting follows the environment with layered color temperature and restrained color spill'
    )
  },
  {
    id: 'advertising.impact',
    group: 'advertising',
    titleKey: 'shot.staging.preset.adImpact',
    shotSize: '特写',
    visualDescription: text(
      '聚焦产品、手部或关键机械细节，在冲击发生前保留一瞬停顿，画面边缘带速度与环境反馈。',
      'Focus on the product, hand, or key mechanical detail; hold a beat before impact and retain speed and environmental feedback at the frame edges.'
    ),
    cameraMove: text(
      '短促推进并在动作冲击点轻微震动，以硬切进入下一镜',
      'Brief push-in with a small shake on impact, then hard cut to the next shot'
    )
  },
  {
    id: 'advertising.flash',
    group: 'advertising',
    titleKey: 'shot.staging.preset.adFlash',
    shotSize: '特写',
    cameraMove: text(
      '利用画面内强光或高光溢出完成闪白转场，下一镜从同方向光线显现',
      'Use motivated bright light or highlight bloom for a flash transition; reveal the next shot from the same light direction'
    )
  },
  {
    id: 'advertising.motion',
    group: 'advertising',
    titleKey: 'shot.staging.preset.adMotion',
    shotSize: '中景',
    cameraMove: text(
      '让主体或镜头快速横移形成运动模糊，在同方向速度上匹配切入下一镜',
      'Create motion blur with a fast subject or camera sweep, then match-cut into the next shot with the same direction and speed'
    )
  },
  {
    id: 'advertising.dissolve',
    group: 'advertising',
    titleKey: 'shot.staging.preset.adDissolve',
    cameraMove: text(
      '镜头结尾保持主体稳定并缓慢降低动作幅度，以短叠化进入下一镜；前后镜头匹配色调、亮度和画面重心，适合舒缓叙事',
      'Settle the subject and reduce motion at the end, then use a short dissolve into a shot matched in tone, luminance, and visual weight for gentle pacing'
    )
  },
  {
    id: 'advertising.matchCut',
    group: 'advertising',
    titleKey: 'shot.staging.preset.adMatchCut',
    cameraMove: text(
      '匹配剪辑：让当前镜头的形状、颜色、构图位置或动作轨迹与下一镜中的对应元素对齐，在视觉相似点完成切换',
      'Match cut: align a shape, color, frame position, or motion path with its counterpart in the next shot and cut at the visual correspondence'
    )
  },
  {
    id: 'advertising.occlusion',
    group: 'advertising',
    titleKey: 'shot.staging.preset.adOcclusion',
    cameraMove: text(
      '利用人物、产品或环境前景从近处完全遮挡镜头，在遮满画面的一瞬替换场景，下一镜沿相同方向移出遮挡',
      'Let a person, product, or foreground object fully occlude the lens; replace the scene at full coverage and reveal the next shot in the same direction'
    )
  },
  {
    id: 'advertising.focus',
    group: 'advertising',
    titleKey: 'shot.staging.preset.adFocus',
    cameraMove: text(
      '缓慢将当前主体拉至虚焦，让背景光斑或色块充满画面；下一镜从相近模糊形态开始并平滑对焦到新主体',
      'Slowly defocus the current subject until bokeh or color fields fill the frame; begin the next shot with a similar blur and rack focus onto the new subject'
    )
  },
  {
    id: 'advertising.jumpCut',
    group: 'advertising',
    titleKey: 'shot.staging.preset.adJumpCut',
    cameraMove: text(
      '保持机位和构图基本不变，删去动作中间时间形成连续跳切；每次切换都推进状态变化，用于强调效率、步骤或紧张节奏',
      'Keep camera and composition nearly fixed while removing intervals within the action; each jump advances the state to emphasize efficiency, steps, or tension'
    )
  },
  {
    id: 'advertising.productReveal',
    group: 'advertising',
    titleKey: 'shot.staging.preset.adProductReveal',
    shotSize: '特写',
    visualDescription: text(
      '从产品材质、标识或功能结构的局部开始，表面保留真实微划痕、凝露或反射变化；最终露出完整产品和明确卖点。',
      'Begin on material, branding, or a functional product detail with believable micro-scratches, condensation, or shifting reflections; end on the complete product and its key benefit.'
    ),
    lighting: text(
      '条形高光沿产品曲面移动，轮廓光分离背景，材质反射受控且不过曝',
      'Strip highlights travel across product curves; rim light separates the background and reflections stay controlled without clipping'
    ),
    cameraMove: text(
      '微距缓慢推进并小幅环绕，跟随高光揭示结构，结尾拉远到英雄产品镜头并停稳',
      'Slow macro push with a shallow orbit following highlights across the form, then pull back into a stable hero product shot'
    )
  }
] as const

function resolveText(value: LocalizedText | undefined, locale?: string): string | undefined {
  if (!value) return undefined
  return locale?.toLowerCase().startsWith('en') ? value.en : value.zh
}

function insertTextAt(value: string, text: string | undefined, position?: number): string {
  if (!text) return value
  const at = Math.max(0, Math.min(position ?? value.length, value.length))
  return `${value.slice(0, at)}${text}${value.slice(at)}`
}

export function resolveShotStagingPresetText(
  preset: ShotStagingPreset,
  field: ShotStagingTextField,
  locale?: string
): string | undefined {
  return resolveText(preset[field], locale)
}

export function shotStagingGroupTitleKey(group: ShotStagingGroup): string {
  return `shot.staging.group.${group}`
}

export function applyShotStagingPreset(
  storyboard: ShotStoryboard,
  preset: ShotStagingPreset,
  locale?: string,
  options?: {
    insertAt?: Partial<Record<ShotStagingTextField, number>>
  }
): ShotStoryboard {
  return {
    ...storyboard,
    visualDescription: insertTextAt(
      storyboard.visualDescription,
      resolveText(preset.visualDescription, locale),
      options?.insertAt?.visualDescription
    ),
    shotSize: storyboard.shotSize || preset.shotSize || '',
    lighting: insertTextAt(
      storyboard.lighting,
      resolveText(preset.lighting, locale),
      options?.insertAt?.lighting
    ),
    cameraMove: insertTextAt(
      storyboard.cameraMove,
      resolveText(preset.cameraMove, locale),
      options?.insertAt?.cameraMove
    ),
    finalPrompt: ''
  }
}

export function shotStagingPresetTargetFields(
  preset: ShotStagingPreset
): (keyof Pick<ShotStoryboard, 'visualDescription' | 'shotSize' | 'lighting' | 'cameraMove'>)[] {
  const fields: (keyof Pick<
    ShotStoryboard,
    'visualDescription' | 'shotSize' | 'lighting' | 'cameraMove'
  >)[] = []
  if (preset.visualDescription) fields.push('visualDescription')
  if (preset.shotSize) fields.push('shotSize')
  if (preset.lighting) fields.push('lighting')
  if (preset.cameraMove) fields.push('cameraMove')
  return fields
}
