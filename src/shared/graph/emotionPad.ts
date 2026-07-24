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
    { label: '温柔安详', prompt: 'gentle serene expression, soft warm gaze, peaceful smile' },
    { label: '平静柔和', prompt: 'calm soft expression, mild friendly look' },
    { label: '平静中性', prompt: 'neutral calm face, relaxed expression, blank look' },
    { label: '淡然疏离', prompt: 'detached calm face, cool distant gaze' },
    { label: '冷漠平静', prompt: 'cold indifferent expression, emotionless calm stare' }
  ],
  // y=1
  [
    { label: '亲切温和', prompt: 'kind gentle expression, approachable soft smile' },
    { label: '温和含蓄', prompt: 'mild reserved expression, subtle softness' },
    { label: '平静淡定', prompt: 'composed calm expression, steady eyes' },
    { label: '疏离克制', prompt: 'restrained distant look, controlled expression' },
    { label: '冷淡疏离', prompt: 'aloof cold expression, distant eyes' }
  ],
  // y=2 中性激动度
  [
    { label: '亲近友善', prompt: 'friendly close expression, warm eye contact' },
    { label: '自然亲和', prompt: 'natural amiable expression, easy smile' },
    { label: '情绪中性', prompt: 'neutral facial expression, baseline emotion' },
    { label: '疏远戒备', prompt: 'wary distant expression, guarded look' },
    { label: '隐忍愠怒', prompt: 'suppressed anger, tense jaw, restrained resentful look, distant glare' }
  ],
  // y=3
  [
    { label: '热情亲近', prompt: 'enthusiastic warm expression, bright eager eyes' },
    { label: '兴奋愉悦', prompt: 'excited joyful expression, lively smile' },
    { label: '激动振奋', prompt: 'aroused intense expression, energetic look' },
    { label: '焦躁疏离', prompt: 'agitated distant expression, restless uneasy look' },
    { label: '愤怒疏离', prompt: 'angry distant glare, hostile frown, cold fury' }
  ],
  // y=4 激动
  [
    { label: '狂热亲近', prompt: 'fervent passionate expression, intense affectionate gaze' },
    { label: '狂喜激动', prompt: 'ecstatic excited expression, exaggerated joy' },
    { label: '极度激动', prompt: 'highly aroused intense expression, dramatic emotion' },
    { label: '激动排斥', prompt: 'agitated rejecting expression, intense aversion' },
    { label: '暴怒疏离', prompt: 'furious enraged expression, extreme anger, hostile distant stare' }
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
