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
