export interface LocalizedText {
  zh: string
  en: string
}

export interface AiPoseInstructionPreset {
  id: string
  /** i18n：director.stage.poseAiPreset.<id> */
  labelKey: string
  instruction: LocalizedText
}

const text = (zh: string, en: string): LocalizedText => ({ zh, en })

/**
 * AI 姿势指令常用模板。文案写清支撑腿/摆动腿、对侧手臂与躯干扭转，便于模型生成精确静帧。
 */
export const AI_POSE_INSTRUCTION_PRESETS: readonly AiPoseInstructionPreset[] = [
  {
    id: 'idle',
    labelKey: 'director.stage.poseAiPreset.idle',
    instruction: text(
      '自然站立休息：重心略偏右腿，左膝微松；双臂自然垂于体侧，肩放松；脊柱直立，头略微前看，整体放松不僵硬。',
      'Relaxed idle stand: weight slightly on the right leg, left knee soft; arms hang naturally, shoulders relaxed; upright spine, gaze forward, not stiff.'
    )
  },
  {
    id: 'walk',
    labelKey: 'director.stage.poseAiPreset.walk',
    instruction: text(
      '走路迈步中段：右腿向前跨出、膝微屈，左腿在后且膝更屈；左臂前摆、右臂后摆；骨盆略向右前侧下沉，脊柱轻微扭转，目视前方。',
      'Walk mid-step: right leg forward with soft knee, left leg back more bent; left arm forward, right arm back; pelvis slightly lower on the forward side, mild spinal twist, looking ahead.'
    )
  },
  {
    id: 'run',
    labelKey: 'director.stage.poseAiPreset.run',
    instruction: text(
      '跑步冲刺静帧：躯干明显前倾；右腿大步前跨、左腿后蹬膝高屈；左臂大幅前摆肘屈约90°，右臂后摆；头略低看前方，动态张力强。',
      'Running sprint still: strong forward lean; right leg long stride forward, left leg driving back with high knee flex; left arm swings high elbow ~90°, right arm back; head slightly down, high energy.'
    )
  },
  {
    id: 'jumpAir',
    labelKey: 'director.stage.poseAiPreset.jumpAir',
    instruction: text(
      '跳跃腾空：双臂上扬或略后摆平衡；髋与双膝屈曲收腿，脚尖略下指；脊柱轻微伸展，胸部打开，面朝前上方，像刚离开地面。',
      'Jump airborne: arms raised or slightly back for balance; hips and both knees flexed, toes pointing slightly down; mild spinal extension, chest open, facing forward-up as if just left the ground.'
    )
  },
  {
    id: 'jumpLand',
    labelKey: 'director.stage.poseAiPreset.jumpLand',
    instruction: text(
      '跳跃落地缓冲：双脚着地感，双膝深度屈曲，髋后坐；躯干前倾，双臂前伸或侧开保持平衡；头前看，重心低稳。',
      'Jump landing absorb: grounded feet, deep knee and hip flex, sit back; torso leans forward, arms forward or out for balance; head looking ahead, low stable center of mass.'
    )
  },
  {
    id: 'wave',
    labelKey: 'director.stage.poseAiPreset.wave',
    instruction: text(
      '右侧挥手致意：身体略转向右；右上臂外展抬起，右肘屈约40°–60°，右腕上扬作挥手；左臂自然下垂；重心偏左腿，表情面向观者。',
      'Wave with right hand: body slightly turned right; right upper arm raised/abducted, elbow flexed ~40–60°, wrist up for waving; left arm relaxed down; weight on left leg, facing the viewer.'
    )
  },
  {
    id: 'handsOnHips',
    labelKey: 'director.stage.poseAiPreset.handsOnHips',
    instruction: text(
      '双手叉腰站立：双脚略分开，重心稳；双手叉于腰侧，肘外展；胸稍挺，下巴微抬，自信站姿。',
      'Hands on hips: feet slightly apart, stable weight; both hands on waist, elbows out; chest slightly up, chin gently lifted, confident stance.'
    )
  },
  {
    id: 'point',
    labelKey: 'director.stage.poseAiPreset.point',
    instruction: text(
      '右手指向前方：右臂前伸指向正前方，肘微直；左臂自然垂或轻屈于体侧；躯干略跟右手方向扭转，目视所指方向。',
      'Point forward with right hand: right arm extended forward, elbow nearly straight; left arm relaxed or softly bent; torso twists slightly toward the pointing direction, gaze along the point.'
    )
  },
  {
    id: 'think',
    labelKey: 'director.stage.poseAiPreset.think',
    instruction: text(
      '托腮思考：重心偏一侧；右手抬至下颌/面颊轻托，右肘屈；左臂交叠或垂于身前；头略侧倾低头思考，肩放松。',
      'Thinking chin-rest: weight shifted to one side; right hand raised to chin/cheek, elbow bent; left arm folded or resting in front; head slightly tilted down in thought, shoulders soft.'
    )
  },
  {
    id: 'crouch',
    labelKey: 'director.stage.poseAiPreset.crouch',
    instruction: text(
      '深蹲警戒：双膝深屈、髋下沉，上身微前倾；双手可置于膝前或抬起防护；头抬起观察前方，重心低、随时可起身。',
      'Deep crouch ready: deep knee and hip flex, torso slightly forward; hands near knees or raised guard; head up scanning ahead, low center of mass ready to rise.'
    )
  },
  {
    id: 'kneel',
    labelKey: 'director.stage.poseAiPreset.kneel',
    instruction: text(
      '右膝单跪：右膝着地、左脚前撑；躯干直立或微前倾；双手可放在左膝上；头正视前方，稳定单跪姿势。',
      'Right-knee kneel: right knee down, left foot planted forward; torso upright or slight lean; hands may rest on the left knee; head facing forward, stable half-kneel.'
    )
  },
  {
    id: 'bow',
    labelKey: 'director.stage.poseAiPreset.bow',
    instruction: text(
      '鞠躬致意：双脚并拢站稳；髋为轴上身前倾约30°–45°，脊柱连贯弯曲；双臂垂于体侧或身前；头随躯干低下，礼貌正式。',
      'Formal bow: feet together; hinge at hips with torso bent ~30–45°, continuous spine curve; arms at sides or front; head follows the torso down, polite and formal.'
    )
  },
  {
    id: 'fightGuard',
    labelKey: 'director.stage.poseAiPreset.fightGuard',
    instruction: text(
      '运动训练戒备站姿：左脚在前右脚在后，膝微屈；双手抬至下颌前方护面，肘内收；躯干略侧对前方，重心居中可移动，目光平视前方。',
      'Athletic ready stance: left foot forward, right back, soft knees; both hands up near the jaw for guard, elbows in; torso slightly bladed forward, mobile center of mass, looking ahead.'
    )
  },
  {
    id: 'sit',
    labelKey: 'director.stage.poseAiPreset.sit',
    instruction: text(
      '端坐姿势（无椅子也可表现坐姿感）：髋膝约90°屈曲，躯干直立；双手放在大腿上；双脚平放地面感，肩放松，头正直前视。',
      'Seated pose (chair optional): hips and knees ~90° flexed, upright torso; hands on thighs; feet feel planted, shoulders relaxed, head level looking forward.'
    )
  },
  {
    id: 'sitFloor',
    labelKey: 'director.stage.poseAiPreset.sitFloor',
    instruction: text(
      '席地盘坐/冥想：骨盆贴近地面，双大腿外展屈髋，小腿内收交叉；脊柱自然挺直，双手轻放于膝上，神态平静放松。',
      'Cross-legged floor sit: pelvis low to the ground, thighs abducted and flexed, lower legs folded inward; spine naturally upright, hands resting on knees, calm posture.'
    )
  },
  {
    id: 'lieDown',
    labelKey: 'director.stage.poseAiPreset.lieDown',
    instruction: text(
      '仰卧平躺休息：身体水平仰躺于地面，脊柱舒展；双腿自然伸直微开，双臂放松置于体侧，头部略微侧转。',
      'Supine lying down: body lying flat on the back, spine relaxed; legs extended naturally with slight spread, arms resting softly by the sides, head gently turned.'
    )
  },
  {
    id: 'lean',
    labelKey: 'director.stage.poseAiPreset.lean',
    instruction: text(
      '休闲斜靠墙面：重心落于左支撑腿，右腿微屈交叉或轻点地面；背肩略向后倚靠，双臂自然环抱或插兜感，姿态潇洒松弛。',
      'Casual wall lean: weight on left standing leg, right leg bent casually; upper back slightly leaning back, arms relaxed or casually folded, effortless stance.'
    )
  },
  {
    id: 'cheer',
    labelKey: 'director.stage.poseAiPreset.cheer',
    instruction: text(
      '双臂高举欢呼：双臂向斜上方高举呈V字，肘微屈；胸腔打开、脊柱轻度后仰伸展，抬头面向前上方，充满喜悦与胜利感。',
      'Cheering celebration: both arms raised high in a V shape, elbows soft; chest open with mild spinal extension, head tilted up joyfully.'
    )
  },
  {
    id: 'clap',
    labelKey: 'director.stage.poseAiPreset.clap',
    instruction: text(
      '胸前鼓掌喝彩：上身微前倾，双上臂前抬、双肘屈曲使双手在胸前合拢拍掌；头部微点，神态专注热情。',
      'Clapping applause: slight forward torso lean, upper arms slightly forward with elbows bent bringing hands together in front of chest.'
    )
  },
  {
    id: 'dance',
    labelKey: 'director.stage.poseAiPreset.dance',
    instruction: text(
      '律动舞蹈姿态：骨盆与胸廓反向律动侧倾，左臂高举律动、右臂在胸前摆动；双膝微屈富有弹性，头部随节奏轻侧。',
      'Rhythmic dance groove: contrapposto hip and ribcage tilt, left arm raised in groove, right arm swinging across chest; bouncy knees, head tilted with rhythm.'
    )
  },
  {
    id: 'stretch',
    labelKey: 'director.stage.poseAiPreset.stretch',
    instruction: text(
      '伸懒腰舒展：双臂高举向后上方伸展，胸部挺起、脊柱轻度后弓；头部微仰，全身肌肉舒展放松。',
      'Morning stretch: both arms reaching high and slightly back, chest lifted with gentle back arch; head tilted back in a full-body stretch.'
    )
  },
  {
    id: 'talk',
    labelKey: 'director.stage.poseAiPreset.talk',
    instruction: text(
      '自然交谈手势：自然站立，双肘屈曲抬至胸腹前，右手微抬做讲解手势，左手辅助配合；身体微倾，目光注视对方。',
      'Conversational gesture: natural stance, elbows bent at chest level with right hand gesturing expressively and left hand supporting; attentive gaze.'
    )
  },
  {
    id: 'phone',
    labelKey: 'director.stage.poseAiPreset.phone',
    instruction: text(
      '低头看手机/阅读：颈部与头部前倾低垂；右上臂微抬、右肘深屈将右手举至胸前偏上方持握手机；左臂自然放松下垂。',
      'Looking at phone: neck and head bowed down; right elbow bent holding phone in front of upper chest; left arm relaxed at side.'
    )
  },
  {
    id: 'drink',
    labelKey: 'director.stage.poseAiPreset.drink',
    instruction: text(
      '举杯畅饮：右手抬至嘴边作举杯饮水状，右肘屈曲外展；头部微仰配合饮水动作，左臂自然垂放。',
      'Drinking toast: right hand raised to mouth holding a cup, right elbow bent; head slightly tilted back, left arm relaxed.'
    )
  },
  {
    id: 'crossArms',
    labelKey: 'director.stage.poseAiPreset.crossArms',
    instruction: text(
      '抱胸自信站姿：双脚与肩同宽稳立，双臂在胸前交叉环抱，胸膛微挺，头部平视略带审视或自信神态。',
      'Arms crossed stance: feet shoulder-width apart, both arms folded across chest, chest slightly lifted, confident gaze.'
    )
  },
  {
    id: 'lookAround',
    labelKey: 'director.stage.poseAiPreset.lookAround',
    instruction: text(
      '遮阳远眺张望：躯干与头部明显转向一侧远方，右手抬至额前作遮阳瞭望状，左手自然微屈维持平衡。',
      'Looking around / scouting: torso and head turned toward the distance, right hand raised to brow shielding eyes, left arm balanced.'
    )
  },
  {
    id: 'pushUp',
    labelKey: 'director.stage.poseAiPreset.pushUp',
    instruction: text(
      '俯卧撑支撑锻炼：身体俯卧呈平板斜撑，双手撑地承重，脊柱与双腿保持笔直，抬头目视前方地面。',
      'Push-up plank exercise: prone plank body angle supported on hands and toes, straight spine and legs, head looking slightly ahead.'
    )
  },
  {
    id: 'fall',
    labelKey: 'director.stage.poseAiPreset.fall',
    instruction: text(
      '受击失衡跌倒：重心完全后移下沉接近地面，躯干后仰倒地，双臂本能向两侧张开维持平衡，双腿微屈抬起。',
      'Falling backward impact: center of mass dropped low and back, torsofalling supine, arms flung wide instinctively, knees slightly bent.'
    )
  },
  {
    id: 'kick',
    labelKey: 'director.stage.poseAiPreset.kick',
    instruction: text(
      '高抬腿侧踢/正踢：左腿稳固支撑地面，右腿高高踢起伸直；上身微后倾平衡重心，双臂屈肘护于胸前两侧。',
      'High kick action: left leg planted firmly, right leg kicked high forward; torso leans slightly back for balance, arms in guard.'
    )
  }
]

export function resolveAiPosePresetInstruction(
  preset: AiPoseInstructionPreset,
  locale: string
): string {
  return locale.toLowerCase().startsWith('en') ? preset.instruction.en : preset.instruction.zh
}

/** 指令文本是否匹配某常用预设（用于执行日志标题等） */
export function matchAiPosePresetId(instruction: string, locale: string): string | null {
  const text = instruction.trim()
  if (!text) return null
  for (const preset of AI_POSE_INSTRUCTION_PRESETS) {
    if (resolveAiPosePresetInstruction(preset, locale) === text) return preset.id
    if (preset.instruction.zh === text || preset.instruction.en === text) return preset.id
  }
  return null
}
