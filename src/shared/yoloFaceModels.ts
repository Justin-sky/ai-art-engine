/**
 * 人脸两段式模型（BlazeFace 检测器 + FaceMesh）「按角色挑文件」的纯逻辑。
 *
 * 为什么值得单独抽出来并单测：两个模型是**成对**依赖，挑错文件不会当场报错 ——
 * 检测器位置喂了 FaceMesh（或反过来）只是推理时维度不符，渲染层按「可选能力」
 * 降级成空脸，用户看到的是「五官 / 妆容 / 证件照悄悄不生效」，极难定位。
 *
 * 约定名（文件名去扩展名即模型 id）：
 * - 检测器 `face-detect.onnx`（别名 face-detector / blazeface）
 * - FaceMesh `face-landmark.onnx`（别名 face-landmarks / facemesh）
 */
import { YOLO_FACE_DETECT_MODEL_ID, YOLO_FACE_LANDMARK_MODEL_ID, type YoloModelInfo } from './yolo'

export type FaceModelRole = 'detector' | 'landmark'

interface FaceModelRoleSpec {
  /** 约定名与常见别名，按优先级排列 */
  aliases: readonly string[]
  /** 名字特征：这一角色「像自己」的命名（容忍 -v2 / -int8 之类后缀） */
  affinity: RegExp
  /** 名字特征：明确属于**另一个**角色的命名，绝不当作本角色使用（匹配的是小写 id） */
  foreign: RegExp
}

/**
 * 「裸检测器」命名：整个 id 就是检测器本身，绝不能当关键点模型用。
 *
 * 不用 `\bblazeface\b` 之类的词边界：连字符本身也是词边界，那样会把
 * `blazeface-landmarks`（带检测器前缀的关键点模型）一起挡掉。
 */
const BARE_DETECTOR_ID = /^(?:blazeface|face-detect|face-detector)$/

const ROLE_SPECS: Record<FaceModelRole, FaceModelRoleSpec> = {
  detector: {
    aliases: [YOLO_FACE_DETECT_MODEL_ID, 'face-detector', 'blazeface'],
    affinity: /detect|blaze/,
    foreign: /landmark|mesh/
  },
  landmark: {
    aliases: [YOLO_FACE_LANDMARK_MODEL_ID, 'face-landmarks', 'facemesh', 'face-mesh'],
    affinity: /landmark|mesh/,
    /**
     * 关键点侧**只**排除「裸检测器」命名，带前缀的关键点文件照常认：
     * - `face-detect-landmark` / `blazeface-mesh` 这种「检测器前缀 + 关键点关键词」
     *   是真实存在的命名，按 affinity 命中，这里必须放行；
     * - 裸 `blazeface` / `face-detect` / `face-detector` 才是真检测器，排除。
     */
    foreign: BARE_DETECTOR_ID
  }
}

/** 该角色期望的文件名（去扩展名即模型 id），报错与设置页文案共用 */
export function faceModelAliases(role: FaceModelRole): readonly string[] {
  return ROLE_SPECS[role].aliases
}

/** 命中方式，便于日志 / 报错解释「为什么选了这个文件」 */
export type FaceModelPickVia = 'explicit' | 'alias' | 'affinity' | 'fallback'

export interface FaceModelPick {
  model: YoloModelInfo | null
  via: FaceModelPickVia | 'none'
  /** 目录里现有的人脸模型 id（报错时展示，用户可直接核对） */
  available: string[]
}

/** 同体积时按 id 排序，保证同一目录每次挑到同一个文件 */
function bySizeThenId(a: YoloModelInfo, b: YoloModelInfo): number {
  if (b.sizeMb !== a.sizeMb) return b.sizeMb - a.sizeMb
  return a.id.localeCompare(b.id)
}

/**
 * 挑选某个角色要用的模型。
 *
 * 命中顺序：显式 id → 约定名 / 别名 → 名字特征 → 体积兜底。
 * 两处刻意的保守设计：
 * - 名字明显属于另一角色（含 landmark / mesh 的绝不当作检测器；含 detect / blaze 的
 *   绝不当作 FaceMesh）的文件**永不**入选，于是「只放了一个 face-detect.onnx」时
 *   FaceMesh 一侧报「找不到」，而不是拿检测器当 FaceMesh 用（那样只会得到一张空脸）；
 * - 同一个文件不会被两段复用（`excludePath`），避免把两个角色都指到同一份权重。
 */
export function pickFaceModel(input: {
  models: readonly YoloModelInfo[]
  role: FaceModelRole
  /** 调用方显式指定的模型 id（当前只有检测器侧会传） */
  explicit?: string
  /** 另一段已经选中的路径 */
  excludePath?: string
}): FaceModelPick {
  const spec = ROLE_SPECS[input.role]
  const all = input.models.filter((model) => model.kind === 'face')
  const available = all.map((model) => model.id)
  const explicit = input.explicit?.trim()
  if (explicit) {
    const hit = all.find((model) => model.id === explicit)
    return { model: hit ?? null, via: hit ? 'explicit' : 'none', available }
  }

  const candidates = all.filter(
    (model) => model.path !== input.excludePath && !spec.foreign.test(model.id.toLowerCase())
  )
  const alias = candidates.find((model) => spec.aliases.includes(model.id.toLowerCase()))
  if (alias) return { model: alias, via: 'alias', available }

  const ranked = [...candidates].sort(bySizeThenId)
  const affinity = ranked.find((model) => spec.affinity.test(model.id.toLowerCase()))
  if (affinity) return { model: affinity, via: 'affinity', available }

  const fallback = ranked[0]
  return fallback
    ? { model: fallback, via: 'fallback', available }
    : { model: null, via: 'none', available }
}
