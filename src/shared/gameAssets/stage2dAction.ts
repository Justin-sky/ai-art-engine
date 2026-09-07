/**
 * 2D 骨骼动作：pose 关键帧插值循环（5.5「2D 导演台」动作与循环预览）。
 *
 * 在 stage2dRig / stage2dPoseSolve 之上提供「让骨架动起来」的纯函数层：
 * - 动作 = 按时间排序的 pose 关键帧序列（秒制），帧间对每个关节做局部旋转的
 *   **最短路径插值**（角差收敛到 (-180,180]，不会绕一整圈）；
 * - 关键帧只声明「该时刻要覆盖的关节」——未声明的关节按绑定姿势（偏移 0）参与插值，
 *   因此起点 / 终点帧写 `{}` 即可平滑回到绑定姿势，天然闭环；
 * - 播放为循环：采样时间对动作时长取模，`sampleStage2dAction` 与编辑器
 *   rAF 时间轴 / 导出关键帧共用同一实现，预览与产物一致。
 *
 * 动作不依赖具体 rig：pose 以关节 id 为键，播放时 rig 中不存在的关节自然被
 * FK 消费方忽略。数据结构同时作为 P1「Spine 关键帧动画编辑器」时间轴的本地契约。
 *
 * 纯函数，无 DOM / 模型依赖，可单测。
 */
import { type Stage2dPose } from './stage2dRig'

/** pose 关键帧：自动作起点起的时刻 + 该时刻的摆姿快照 */
export interface Stage2dActionKeyframe {
  /** 时刻（秒，非负，自动按升序重排） */
  time: number
  /**
   * 摆姿快照：关节 id → 相对绑定的局部旋转（度）。
   * 未出现的关节视为绑定姿势（偏移 0）；`{}` = 回到绑定姿势。
   */
  pose: Stage2dPose
}

/** 2D 骨骼动作：按时间插值的一串 pose 关键帧 */
export interface Stage2dAction {
  /** 展示名 / 调试标识（可选） */
  name?: string
  /** 是否循环（默认 true） */
  loop?: boolean
  /** 动作总时长（秒）；缺省取最后一个关键帧时刻 */
  duration?: number
  /** 关键帧（自动按 time 升序重排） */
  keyframes: Stage2dActionKeyframe[]
}

/** 角度收敛到 (-180, 180]（与 rig 层同一约定） */
function wrap180(deg: number): number {
  let a = (((deg % 360) + 540) % 360) - 180
  if (a === -180) a = 180
  return a
}

/**
 * 动作归一化：
 * - 关键帧按 time 升序重排、时刻取非负有限数；
 * - 逐帧 pose 角度收敛并剔除非法值；**空 pose 帧（= 绑定姿势）作为普通关键帧保留**，
 *   动作常用 `{}` 帧把骨架带回绑定姿势并让循环回绕平滑；
 * - duration 缺省取最后一帧时刻（保证循环终点帧 = 起点帧语义）；显式提供则不小于最后一帧。
 */
export function normalizeStage2dAction(
  raw?: Stage2dAction | Partial<Stage2dAction> | null
): Stage2dAction {
  const list = Array.isArray(raw?.keyframes) ? raw.keyframes : []
  const frames: Stage2dActionKeyframe[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const pose: Stage2dPose = {}
    const src = entry.pose ?? {}
    for (const [jointId, angle] of Object.entries(src)) {
      const value = Number(angle)
      if (!jointId || !Number.isFinite(value)) continue
      pose[jointId] = wrap180(value)
    }
    const time = Number(entry.time)
    frames.push({
      time: Number.isFinite(time) && time > 0 ? time : 0,
      pose
    })
  }
  frames.sort((a, b) => a.time - b.time)

  const lastTime = frames.length ? frames[frames.length - 1].time : 0
  const explicit = Number(raw?.duration)
  const duration =
    Number.isFinite(explicit) && explicit > 0 ? Math.max(explicit, lastTime) : lastTime

  return {
    name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name : undefined,
    loop: raw?.loop !== false,
    duration,
    keyframes: frames
  }
}

/** 动作时长（秒）；空动作返回 0 */
export function stage2dActionDuration(action: Stage2dAction): number {
  return action?.duration ?? 0
}

/**
 * 两个 pose 快照之间的线性插值（逐关节角度取最短路径）。
 * 关节在某一侧缺失按绑定姿势（偏移 0）参与，输出仍为相对绑定的局部旋转。
 */
export function interpolateStage2dPose(from: Stage2dPose, to: Stage2dPose, t: number): Stage2dPose {
  if (!(t > 0)) return { ...(from ?? {}) }
  if (t >= 1) return { ...(to ?? {}) }
  const fromMap = from ?? {}
  const toMap = to ?? {}
  const jointIds = new Set<string>([...Object.keys(fromMap), ...Object.keys(toMap)])
  const out: Stage2dPose = {}
  for (const jointId of jointIds) {
    const a = Number(fromMap[jointId]) || 0
    const b = Number(toMap[jointId]) || 0
    let delta = b - a
    while (delta > 180) delta -= 360
    while (delta < -180) delta += 360
    const value = wrap180(a + delta * t)
    // 与绑定几乎重合的角度不写进 pose，保持关键帧纯净
    if (Math.abs(value) < 1e-6) continue
    out[jointId] = value
  }
  return out
}

/**
 * 在动作时间轴上采样当前摆姿。
 *
 * @param action   已归一化动作（normalizeStage2dAction 的产物，关键帧按时间升序）
 * @param timeSec  播放时刻（秒）；循环动作对时长取模，非循环则夹在 [0, duration]
 * @returns 该时刻的摆姿快照（可直接喂 computeStage2dRigTransforms）
 */
export function sampleStage2dAction(action: Stage2dAction, timeSec: number): Stage2dPose {
  if (!action || !Array.isArray(action.keyframes)) return {}
  const frames = action.keyframes
  if (!frames.length) return {}
  const duration = Math.max(0, Number(action.duration) || 0)
  if (duration <= 0) return { ...(frames[0]?.pose ?? {}) }

  let t = Number(timeSec) || 0
  if (action.loop !== false) {
    t = ((t % duration) + duration) % duration
  } else {
    t = Math.max(0, Math.min(t, duration))
  }

  const first = frames[0]
  if (t <= first.time || frames.length === 1) return { ...first.pose }

  const last = frames[frames.length - 1]
  if (t >= last.time) return { ...last.pose }

  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i]
    const b = frames[i + 1]
    if (t < a.time || t > b.time) continue
    const span = b.time - a.time
    if (span <= 1e-9) return { ...b.pose }
    return interpolateStage2dPose(a.pose, b.pose, (t - a.time) / span)
  }
  return { ...last.pose }
}
