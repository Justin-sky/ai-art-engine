/**
 * 2D 帧动画：外层节点输入一张图，dive 进内图用生图 API 生成序列图（rows×cols），
 * 外层按行列切分并在 inspector 中逐帧播放预览。
 */
import { createNodeFromType } from './create'
import {
  GRAPH_BOUNDARY_INPUT_TYPE_ID,
  GRAPH_BOUNDARY_OUTPUT_TYPE_ID,
  HOST_INTERFACE_FORMAT_VERSION,
  boundaryInputNodeId,
  boundaryOutputNodeId,
  type HostInterfaceDocument
} from './hostInterface'
import { GraphPortType, type GraphDocument, type GraphEdge, type GraphNode } from './types'

export const ANIM2D_MAX_DIM = 6
export const ANIM2D_MIN_DIM = 1

export interface Anim2dState {
  rows: number
  cols: number
}

export const DEFAULT_ANIM2D_STATE: Anim2dState = { rows: 1, cols: 4 }

function clampDim(n: unknown): number {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v)) return 4
  return Math.min(ANIM2D_MAX_DIM, Math.max(ANIM2D_MIN_DIM, v))
}

export function normalizeAnim2dState(raw?: Partial<Anim2dState> | null): Anim2dState {
  const base = { ...DEFAULT_ANIM2D_STATE, ...(raw ?? {}) }
  return { rows: clampDim(base.rows), cols: clampDim(base.cols) }
}

export function readAnim2dFromNode(params: {
  animRows?: unknown
  animCols?: unknown
}): Anim2dState {
  return normalizeAnim2dState({ rows: Number(params.animRows), cols: Number(params.animCols) })
}

export function anim2dToNodePatch(state: Anim2dState): { animRows: number; animCols: number } {
  const s = normalizeAnim2dState(state)
  return { animRows: s.rows, animCols: s.cols }
}

/** 行优先帧序的格子键（"1-1"、"1-2" …） */
export function anim2dCellKeys(rows: number, cols: number): string[] {
  const s = normalizeAnim2dState({ rows, cols })
  const out: string[] = []
  for (let r = 1; r <= s.rows; r += 1) {
    for (let c = 1; c <= s.cols; c += 1) {
      out.push(`${r}-${c}`)
    }
  }
  return out
}

/** 动画动作预设：动作描述会叠加「按 rows×cols 分格排版」指令 */
export interface Anim2dPreset {
  id: string
  labelKey: string
  prompt: string
  promptEn: string
}

export const ANIM2D_PRESETS: readonly Anim2dPreset[] = [
  {
    id: 'idle',
    labelKey: 'idle',
    prompt: '角色原地待机循环：身体轻微上下起伏，头发与衣摆自然飘动，表情平静，动作幅度小且稳定',
    promptEn: 'Idle loop: subtle body bob, hair and clothes sway naturally, calm expression, small stable movement'
  },
  {
    id: 'walk',
    labelKey: 'walk',
    prompt: '角色侧面行走循环：双腿交替迈步，手臂自然摆动，身体随步伐轻微起伏，包含一个完整步态周期',
    promptEn: 'Side walk loop: alternating legs, natural arm swing, slight body bob, one complete gait cycle'
  },
  {
    id: 'run',
    labelKey: 'run',
    prompt: '角色奔跑循环：身体前倾，双臂屈肘摆动，双腿交替大步，节奏快，动态感强',
    promptEn: 'Run loop: leaning forward, bent arms pumping, long alternating strides, fast rhythm, strong motion'
  },
  {
    id: 'jump',
    labelKey: 'jump',
    prompt: '角色跳跃动作序列：依次为下蹲蓄力、起跳腾空、空中最高点、下落、落地缓冲',
    promptEn: 'Jump sequence: crouch anticipation, takeoff, airborne apex, falling, landing settle'
  },
  {
    id: 'attack',
    labelKey: 'attack',
    prompt: '角色攻击动作序列：依次为预备、挥击、命中、收招，动作干脆有力',
    promptEn: 'Attack sequence: windup, swing, hit, recover, crisp and forceful'
  },
  {
    id: 'hurt',
    labelKey: 'hurt',
    prompt: '角色受击动作序列：身体后仰、表情痛苦、短暂僵直后恢复站姿',
    promptEn: 'Hit reaction sequence: body recoils, pained expression, brief stun then recover to stance'
  },
  {
    id: 'skill',
    labelKey: 'skill',
    prompt: '角色施放技能序列：聚气蓄力、特效爆发、技能释放、收势，附带能量特效',
    promptEn: 'Skill cast sequence: charge up, effect burst, release, settle, with energy VFX'
  }
] as const

export function resolveAnim2dPreset(id: string | undefined): Anim2dPreset | undefined {
  if (!id) return undefined
  return ANIM2D_PRESETS.find((p) => p.id === id)
}

const FRAME_ANIM_SYSTEM_PROMPT_ZH = `你是 AIArtEngine 的 2D 帧动画序列图专家。
请把动作描述绘制成一张严格分格的序列图：
- 整张图横向分为 N 列、纵向分为 M 行，共 N×M 个格子，格子大小完全一致、间距统一（建议不留空隙）；
- 帧序固定为从左到右、从上到下依次为该动作的连续帧；
- 同一角色/主体在所有格子中保持外观、体型、配色与画风完全一致，仅动作与姿态变化；
- 动作连贯、每帧之间过渡自然，符合该动作的运动规律；
- 只输出序列图本身：不加边框、说明文字、水印或多余装饰。`

const FRAME_ANIM_SYSTEM_PROMPT_EN = `You are an expert in 2D frame-animation sprite sheets for AIArtEngine.
Turn the action description into a strictly tiled sequence image:
- The image is divided into N columns and M rows, N×M equal cells with consistent spacing (no gutters preferred);
- Frame order is fixed: left to right, then top to bottom, as consecutive frames of the action;
- The same character/subject keeps identical look, proportions, palette and art style in every cell, only pose changes;
- Motion is fluid and each frame transitions naturally per the action's movement rules;
- Output only the sequence image itself: no borders, captions, watermarks or extra decoration.`

export function resolveFrameAnimGenSystemPrompt(
  override?: string | null,
  locale?: string
): string {
  if (typeof override === 'string' && override.trim()) return override.trim()
  return locale?.startsWith('en') ? FRAME_ANIM_SYSTEM_PROMPT_EN : FRAME_ANIM_SYSTEM_PROMPT_ZH
}

/** 帧数描述 → 序列图排版指令（追加在动作描述后） */
export function buildAnim2dGridInstruction(
  rows: number,
  cols: number,
  locale?: string
): string {
  const r = Math.max(1, Math.floor(rows))
  const c = Math.max(1, Math.floor(cols))
  const total = r * c
  if (locale?.startsWith('en')) {
    return `Draw this as a single sequence image of ${total} frames arranged in a ${r}×${c} grid (${c} columns, ${r} rows), frame order left to right then top to bottom; keep the character identical across all frames.`
  }
  return `将上述动作绘制成一张 ${total} 帧的序列图：横向 ${c} 列、纵向 ${r} 行，共 ${r}×${c} 个等大的格子；帧序从左到右、从上到下；所有格子中的角色保持外观与画风完全一致，仅动作不同。`
}

/** dive 内图结构版本：结构变化时递增，使已存在的内图资产按新结构重建 */
export const ANIM2D_INNER_GRAPH_VERSION = 1

export const ANIM2D_HOST_INPUT_PORT_ID = 'in-image'
export const ANIM2D_HOST_OUTPUT_PORT_ID = 'out-image'

export function buildAnim2dHostInterface(): HostInterfaceDocument {
  return {
    version: HOST_INTERFACE_FORMAT_VERSION,
    inputs: [
      {
        id: ANIM2D_HOST_INPUT_PORT_ID,
        label: '参考图',
        dataType: GraphPortType.image,
        multiple: false
      }
    ],
    outputs: [
      {
        id: ANIM2D_HOST_OUTPUT_PORT_ID,
        label: '序列图',
        dataType: GraphPortType.image,
        multiple: false
      }
    ]
  }
}

/**
 * 构建 2D 帧动画的 dive 内图：
 * 参考图输入边界 → 生成帧动画序列图（frame.animGen）→ 序列图输出边界。
 * rows/cols/预设动作烘焙进 frame.animGen 节点参数，dive 后仍可编辑。
 */
export function buildAnim2dInnerGraph(
  state: Anim2dState,
  presetId: string,
  instruction: string,
  locale?: string
): GraphDocument {
  const s = normalizeAnim2dState(state)
  const preset = resolveAnim2dPreset(presetId)
  const inId = boundaryInputNodeId(ANIM2D_HOST_INPUT_PORT_ID)
  const genId = 'anim-gen-1'
  const outId = boundaryOutputNodeId(ANIM2D_HOST_OUTPUT_PORT_ID)

  const nodes: GraphNode[] = [
    {
      id: inId,
      typeId: GRAPH_BOUNDARY_INPUT_TYPE_ID,
      category: 'note',
      position: { x: 40, y: 80 },
      title: '参考图',
      params: {
        previewCollapsed: true,
        hostBoundaryPort: {
          portId: ANIM2D_HOST_INPUT_PORT_ID,
          dataType: GraphPortType.image,
          multiple: false
        }
      }
    },
    createNodeFromType(
      'frame.animGen',
      { x: 280, y: 80 },
      {
        id: genId,
        title: '生成帧动画序列图',
        params: {
          animRows: s.rows,
          animCols: s.cols,
          animPresetId: presetId,
          generateInstruction: instruction.trim() || preset?.prompt || '',
          generateSystemPrompt: resolveFrameAnimGenSystemPrompt(undefined, locale)
        }
      }
    ),
    {
      id: outId,
      typeId: GRAPH_BOUNDARY_OUTPUT_TYPE_ID,
      category: 'note',
      position: { x: 520, y: 80 },
      title: '序列图',
      params: {
        previewCollapsed: true,
        hostBoundaryPort: {
          portId: ANIM2D_HOST_OUTPUT_PORT_ID,
          dataType: GraphPortType.image,
          multiple: false
        }
      }
    }
  ]

  const edges: GraphEdge[] = [
    {
      id: 'anim-e-in',
      source: inId,
      target: genId,
      sourcePort: 'out',
      targetPort: 'in'
    },
    {
      id: 'anim-e-out',
      source: genId,
      target: outId,
      sourcePort: 'out',
      targetPort: 'in'
    }
  ]

  return { nodes, edges, groups: [], viewport: { x: 0, y: 0, zoom: 1 } }
}
