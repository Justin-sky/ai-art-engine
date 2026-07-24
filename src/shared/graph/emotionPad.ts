/**
 * 情绪调节：5×5 情绪坐标盘 ↔ 标签 / 提示词。
 * 轴：X 亲近(0)→疏离(4)，Y 平静(0)→激动(4)；中心 (2,2) 为中性。
 */

export const EMOTION_GRID_SIZE = 5

export type EmotionGridIndex = 0 | 1 | 2 | 3 | 4

export interface EmotionPadState {
  gridX: EmotionGridIndex
  gridY: EmotionGridIndex
}

export interface EmotionCellDef {
  /** 情绪定位短名 */
  label: string
  /** 下游生图用提示词片段 */
  prompt: string
}

/**
 * cells[y][x]：行=激动度(Y)，列=亲疏(X)
 * 截图选中 (x=4,y=2) ≈ 隐忍愠怒
 */
export const EMOTION_GRID: readonly (readonly EmotionCellDef[])[] = [
  // y=0 平静
  [
    {
      label: '温柔安详',
      prompt:
        '温暖注视，眼睑放松，唇角轻扬，呼吸平稳，肩膀自然下沉；gentle serene expression'
    },
    {
      label: '平静柔和',
      prompt: '眉眼舒展，轻微友善微笑，面部与下颌放松；calm soft expression'
    },
    {
      label: '平静中性',
      prompt: '面部肌肉自然放松，稳定眨眼，嘴唇自然闭合；neutral calm face'
    },
    {
      label: '淡然疏离',
      prompt:
        '视线越过主体看向远处，唇角平直，头部轻微侧开；detached distant gaze'
    },
    {
      label: '冷漠平静',
      prompt:
        '眨眼缓慢，目光缺少回应，下颌稳定，身体保持距离；cold indifferent stare'
    }
  ],
  // y=1
  [
    {
      label: '亲切温和',
      prompt: '眼角轻弯，唇角自然上扬，身体略向前倾；kind gentle expression'
    },
    {
      label: '温和含蓄',
      prompt: '短暂眼神接触后移开，克制微笑，手指放松；mild reserved expression'
    },
    {
      label: '平静淡定',
      prompt: '目光稳定，均匀呼吸，肩颈与下颌放松；composed calm expression'
    },
    {
      label: '疏离克制',
      prompt: '眼神保持距离，嘴唇轻抿，肩膀略微收紧；restrained distant look'
    },
    {
      label: '冷淡疏离',
      prompt: '目光侧开，唇角下压，身体微微后撤；aloof cold expression'
    }
  ],
  // y=2 中性激动度
  [
    {
      label: '亲近友善',
      prompt:
        '温暖眼神接触，眉毛轻抬，身体自然朝向对方；friendly warm eye contact'
    },
    {
      label: '自然亲和',
      prompt: '自然微笑，眨眼节奏放松，手势开放；natural amiable expression'
    },
    {
      label: '情绪中性',
      prompt:
        '五官与身体处于自然基线，稳定呼吸，无刻意表情；neutral baseline emotion'
    },
    {
      label: '疏远戒备',
      prompt: '眉间轻收，视线快速扫动，嘴唇收紧，重心后移；wary guarded look'
    },
    {
      label: '隐忍愠怒',
      prompt:
        '唇角紧抿，眉头微皱，鼻翼翕张，下颌绷紧，压住怒意；suppressed anger'
    }
  ],
  // y=3
  [
    {
      label: '热情亲近',
      prompt:
        '眼睛明亮，笑容展开，身体主动前倾，手势有活力；enthusiastic warm expression'
    },
    {
      label: '兴奋愉悦',
      prompt:
        '眉毛上扬，笑肌抬起，呼吸加快，身体轻微弹动；excited joyful expression'
    },
    {
      label: '激动振奋',
      prompt:
        '眼神强烈，嘴唇微张，胸腔起伏明显，拳头轻握；intense energized expression'
    },
    {
      label: '焦躁疏离',
      prompt:
        '快速眨眼，眉间收紧，手指反复动作，重心不断转换；agitated uneasy look'
    },
    {
      label: '愤怒疏离',
      prompt: '目光冷硬，眉头下压，鼻翼张开，肩颈紧绷；angry hostile glare'
    }
  ],
  // y=4 激动
  [
    {
      label: '狂热亲近',
      prompt:
        '持续强烈注视，瞳孔放大，呼吸急促，身体明显靠近；fervent passionate gaze'
    },
    {
      label: '狂喜激动',
      prompt: '眼睛睁大，笑容完全展开，肩膀抬起，动作轻快外放；ecstatic joy'
    },
    {
      label: '极度激动',
      prompt:
        '快速呼吸，眼神跳动，面部与手部动作幅度增大但保持生理自然；high arousal'
    },
    {
      label: '激动排斥',
      prompt: '眉鼻皱起，嘴角向下，头部后仰，手掌向外阻挡；intense aversion'
    },
    {
      label: '暴怒疏离',
      prompt:
        '眉头强烈下压，鼻翼扩张，牙关与下颌绷紧，拳头握紧，死死盯视；furious rage'
    }
  ]
] as const

export const DEFAULT_EMOTION_PAD: EmotionPadState = {
  gridX: 2,
  gridY: 2
}

export function clampEmotionIndex(value: number): EmotionGridIndex {
  if (!Number.isFinite(value)) return 2
  const v = Math.max(0, Math.min(EMOTION_GRID_SIZE - 1, Math.round(value)))
  return v as EmotionGridIndex
}

export function normalizeEmotionPad(
  raw?: Partial<EmotionPadState> | null
): EmotionPadState {
  const base = { ...DEFAULT_EMOTION_PAD, ...(raw ?? {}) }
  return {
    gridX: clampEmotionIndex(base.gridX),
    gridY: clampEmotionIndex(base.gridY)
  }
}

export function getEmotionCell(state: EmotionPadState): EmotionCellDef {
  const s = normalizeEmotionPad(state)
  return EMOTION_GRID[s.gridY]![s.gridX]!
}

export function buildEmotionPrompt(state: EmotionPadState): string {
  const cell = getEmotionCell(state)
  return `${cell.label}，${cell.prompt}`
}

export function resolveEmotionOutputPrompt(state: EmotionPadState): string {
  return buildEmotionPrompt(state)
}

export function readEmotionPadFromNode(params: {
  emotionPad?: Partial<EmotionPadState>
}): EmotionPadState {
  return normalizeEmotionPad(params.emotionPad)
}

export function emotionPadToNodePatch(state: EmotionPadState): {
  emotionPad: EmotionPadState
  emotionPrompt: string
  emotionLabel: string
} {
  const normalized = normalizeEmotionPad(state)
  const cell = getEmotionCell(normalized)
  return {
    emotionPad: normalized,
    emotionLabel: cell.label,
    emotionPrompt: resolveEmotionOutputPrompt(normalized)
  }
}

/** 轴标签：供 UI 使用（i18n 也可覆盖） */
export const EMOTION_AXIS = {
  xMin: '亲近',
  xMax: '疏离',
  yMin: '平静',
  yMax: '激动'
} as const
