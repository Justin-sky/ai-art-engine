import type { ShotStoryboard } from '../domain'

export type ShotStagingGroup =
  | 'cameraLanguage'
  | 'bodyFacing'
  | 'performance'
  | 'lighting'
  | 'advertising'

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
    lighting: text('强轮廓逆光，空气中可见尘雾或体积光，史诗氛围', 'Strong rim backlight with visible haze or volumetric light; epic mood'),
    cameraMove: text('从局部特写缓慢上摇并推进，经中景落到面部特写', 'Slow tilt-up and push-in from a detail, through a medium shot, ending on a facial close-up')
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
    lighting: text('高反差暗调，人物从明处走入阴影，环境微尘可见', 'High-contrast low-key light; subject moves from light into shadow with subtle airborne dust'),
    cameraMove: text('轻微手持缓慢跟进，沿身体上移后绕至四分之三侧面', 'Subtle handheld slow follow; travel upward along the body and arc to a three-quarter angle')
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
    cameraMove: text('平视手持跟拍并做缓慢小幅环绕，运动带轻微呼吸感', 'Eye-level handheld tracking with a slow shallow orbit and subtle human breathing motion')
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
    cameraMove: text('稳定机位或极缓慢推进，优先保留双人互动和空间关系', 'Locked camera or a very slow push-in, prioritizing interaction and spatial continuity')
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
    cameraMove: text('固定或轻微推进，切换反打时遵守轴线与视线匹配', 'Locked or slight push-in; preserve screen direction and eyeline across the reverse angle')
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
    cameraMove: text('从平视缓慢升高并转为俯视，情绪逐步下沉', 'Slowly rise from eye level into a high angle as the emotional weight deepens')
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
    cameraMove: text('缓慢跟随或静止观察，不抢先揭示人物正脸', 'Slow follow or locked observation; do not reveal the face prematurely')
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
    cameraMove: text('轻微不稳定推近，可在关键情绪点进一步倾斜画面', 'A subtly unstable push-in, increasing the tilt at the emotional beat')
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
    cameraMove: text('在眼神锁定时加入一次短促、不稳定的微推镜', 'Add a brief unstable micro push-in when the gaze locks')
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
    id: 'advertising.impact',
    group: 'advertising',
    titleKey: 'shot.staging.preset.adImpact',
    shotSize: '特写',
    visualDescription: text(
      '聚焦产品、手部或关键机械细节，在冲击发生前保留一瞬停顿，画面边缘带速度与环境反馈。',
      'Focus on the product, hand, or key mechanical detail; hold a beat before impact and retain speed and environmental feedback at the frame edges.'
    ),
    cameraMove: text('短促推进并在动作冲击点轻微震动，以硬切进入下一镜', 'Brief push-in with a small shake on impact, then hard cut to the next shot')
  },
  {
    id: 'advertising.flash',
    group: 'advertising',
    titleKey: 'shot.staging.preset.adFlash',
    shotSize: '特写',
    cameraMove: text('利用画面内强光或高光溢出完成闪白转场，下一镜从同方向光线显现', 'Use motivated bright light or highlight bloom for a flash transition; reveal the next shot from the same light direction')
  },
  {
    id: 'advertising.motion',
    group: 'advertising',
    titleKey: 'shot.staging.preset.adMotion',
    shotSize: '中景',
    cameraMove: text('让主体或镜头快速横移形成运动模糊，在同方向速度上匹配切入下一镜', 'Create motion blur with a fast subject or camera sweep, then match-cut into the next shot with the same direction and speed')
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
