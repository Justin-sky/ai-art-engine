/**
 * 许愿式编程（Vibe Coding）二次元流星祈愿池：
 * 咒语词库、任务上下文感知分流与暴击祈福逻辑。
 */

export type WishChantCategory = 'general' | 'image' | 'video' | 'code3d'

export type WishShrinePhase = 'idle' | 'praying' | 'crit' | 'success' | 'error'

export interface WishChantEntry {
  id: string
  category: WishChantCategory | 'crit'
  zh: string
  en: string
  /** 视觉色调：普通符咒 / 招财省钱 / 暴击金光 / 护体绿光 */
  tone: 'charm' | 'gold' | 'emerald' | 'cyan' | 'crit'
}

export interface WishFloatingChant {
  uid: number
  id: string
  text: string
  tone: WishChantEntry['tone']
  critical: boolean
  /** 纵向偏移轨迹微调（px），让每条从口中飘出的咒语错落有致 */
  laneOffsetY: number
  /** 漂浮持续时间（ms） */
  durationMs: number
}

/** 通用许愿式编程核心网络潮词（不报错、一次成功、少花钱等） */
export const GENERAL_WISH_CHANTS: readonly WishChantEntry[] = [
  {
    id: 'no-error',
    category: 'general',
    zh: '🙏 不报错！绝不报红！', // cjk-ok
    en: '🙏 Zero Errors! No Red Logs!',
    tone: 'emerald'
  },
  {
    id: 'one-shot',
    category: 'general',
    zh: '✨ 一次成功 · 遍地绿灯', // cjk-ok
    en: '✨ First-Try Success · All Green',
    tone: 'charm'
  },
  {
    id: 'save-money',
    category: 'general',
    zh: '💰 少花钱 · 省点 Token', // cjk-ok
    en: '💰 Spend Less · Save Tokens',
    tone: 'gold'
  },
  {
    id: 'fast-output',
    category: 'general',
    zh: '⚡ 秒出结果 · 拒绝卡顿', // cjk-ok
    en: '⚡ Instant Output · Zero Lag',
    tone: 'cyan'
  },
  {
    id: 'no-regression',
    category: 'general',
    zh: '🛡️ 千万别改坏旧逻辑', // cjk-ok
    en: '🛡️ Never Break Existing Code',
    tone: 'emerald'
  },
  {
    id: 'mind-align',
    category: 'general',
    zh: '🎯 脑电波 100% 对齐', // cjk-ok
    en: '🎯 100% Mind-Read Alignment',
    tone: 'charm'
  },
  {
    id: 'cyber-karma',
    category: 'general',
    zh: '🧘 赛博功德 +1 · Bug 退散', // cjk-ok
    en: '🧘 Cyber Karma +1 · Bugs Begone',
    tone: 'gold'
  },
  {
    id: 'zero-hallucination',
    category: 'general',
    zh: '🍀 锦鲤附体 · 拒绝幻觉', // cjk-ok
    en: '🍀 Lucky Koi · Zero Hallucination',
    tone: 'emerald'
  },
  {
    id: 'clean-code',
    category: 'general',
    zh: '🚀 逻辑严丝合缝 · 一步到位', // cjk-ok
    en: '🚀 Flawless Logic · One-Shot Win',
    tone: 'cyan'
  },
  {
    id: 'peak-taste',
    category: 'general',
    zh: '💎 审美在线 · 细节拉满', // cjk-ok
    en: '💎 Peak Aesthetics · Max Detail',
    tone: 'charm'
  }
] as const

/** 场景专属咒语（生图 / 视频 / 3D 与代码） */
export const CONTEXT_WISH_CHANTS: Record<
  Exclude<WishChantCategory, 'general'>,
  readonly WishChantEntry[]
> = {
  image: [
    {
      id: 'img-fingers',
      category: 'image',
      zh: '🖐️ 手指千万别多画！', // cjk-ok
      en: '🖐️ Five Fingers Only Please!',
      tone: 'charm'
    },
    {
      id: 'img-masterpiece',
      category: 'image',
      zh: '🎨 构图一次封神 · 拒绝崩坏', // cjk-ok
      en: '🎨 God-Tier Composition · No Melt',
      tone: 'gold'
    },
    {
      id: 'img-lighting',
      category: 'image',
      zh: '✨ 眼神高光拉满 · 发丝分明', // cjk-ok
      en: '✨ Crisp Catchlights & Hair',
      tone: 'cyan'
    }
  ],
  video: [
    {
      id: 'vid-fps',
      category: 'video',
      zh: '🎬 帧率稳如老狗 · 转场丝滑', // cjk-ok
      en: '🎬 Buttery 60fps · Smooth Cuts',
      tone: 'cyan'
    },
    {
      id: 'vid-sync',
      category: 'video',
      zh: '🔊 音画完美卡点 · 一次合成', // cjk-ok
      en: '🔊 Frame-Perfect Audio Sync',
      tone: 'emerald'
    },
    {
      id: 'vid-camera',
      category: 'video',
      zh: '🎞️ 运镜大师附体 · 一镜到底', // cjk-ok
      en: '🎞️ Master Camera Move · One Take',
      tone: 'gold'
    }
  ],
  code3d: [
    {
      id: 'code-compile',
      category: 'code3d',
      zh: '🕹️ 一次编译可玩 · 手感拉满', // cjk-ok
      en: '🕹️ Compile & Play on First Try',
      tone: 'emerald'
    },
    {
      id: 'code-rig',
      category: 'code3d',
      zh: '🦴 骨骼绝不穿模 · 权重丝滑', // cjk-ok
      en: '🦴 Zero Mesh Clipping · Clean Rig',
      tone: 'cyan'
    },
    {
      id: 'code-types',
      category: 'code3d',
      zh: '📦 类型全过 · 零 Warning', // cjk-ok
      en: '📦 Typecheck Clean · 0 Warnings',
      tone: 'gold'
    }
  ]
}

/** 点击祈祷娘触发的「金色欧气暴击」专属咒语 */
export const CRIT_WISH_CHANTS: readonly WishChantEntry[] = [
  {
    id: 'crit-ssr',
    category: 'crit',
    zh: '🌟 欧气暴击！一次成功率 +99%！', // cjk-ok
    en: '🌟 SSR Luck Crit! First-Try +99%!',
    tone: 'crit'
  },
  {
    id: 'crit-bug-flee',
    category: 'crit',
    zh: '🔥 功德暴击 · 所有 Bug 连夜跑路！', // cjk-ok
    en: '🔥 Karma Crit · All Bugs Fled Overnight!',
    tone: 'crit'
  },
  {
    id: 'crit-token-free',
    category: 'crit',
    zh: '🪙 财神加持 · Token 消耗立减护体！', // cjk-ok
    en: '🪙 Wealth Aura · Token Cost Blessed!',
    tone: 'crit'
  },
  {
    id: 'crit-chosen',
    category: 'crit',
    zh: '👑 天选指令 · 必出神作不返工！', // cjk-ok
    en: '👑 Chosen Prompt · Zero Rework Needed!',
    tone: 'crit'
  },
  {
    id: 'crit-mana',
    category: 'crit',
    zh: '⚡ 祈愿加速 x2 · 算力全开！', // cjk-ok
    en: '⚡ Wish Boost x2 · Full GPU Mana!',
    tone: 'crit'
  }
] as const

const IMAGE_PROMPT_RE =
  /(?:生图|画一|绘制|插画|海报|分镜|漫画|修图|精修|抠图|透明底|头像|立绘|image|draw|paint|portrait|cutout|poster|comic|storyboard)/i // cjk-ok

const VIDEO_PROMPT_RE =
  /(?:视频|成片|时间线|转场|配音|字幕|音效|动画|运镜|短片|漫剧|video|timeline|transition|subtitle|sfx|bgm|movie|clip)/i // cjk-ok

const CODE3D_PROMPT_RE =
  /(?:游戏|可玩|3d|blender|建模|骨骼|绑定|导演台|代码|脚本|组件|重构|修复|报错|game|playable|model|rig|shader|script|bug|fix|code)/i // cjk-ok

/** 根据用户刚发送的指令自动识别祈愿偏向 */
export function detectWishPromptCategory(promptText: string): WishChantCategory {
  const text = (promptText ?? '').trim()
  if (!text) return 'general'
  if (VIDEO_PROMPT_RE.test(text)) return 'video'
  if (IMAGE_PROMPT_RE.test(text)) return 'image'
  if (CODE3D_PROMPT_RE.test(text)) return 'code3d'
  return 'general'
}

/**
 * 构建当前会话的循环咒语池：
 * 保证前 3 条必出「不报错」「一次成功」「少花钱」三大经典潮词，随后穿插场景专属咒语。
 */
export function buildWishChantPool(category: WishChantCategory): WishChantEntry[] {
  const coreTop3 = GENERAL_WISH_CHANTS.slice(0, 3)
  const coreRest = GENERAL_WISH_CHANTS.slice(3)
  if (category === 'general') {
    return [...coreTop3, ...coreRest]
  }
  const contextual = CONTEXT_WISH_CHANTS[category] ?? []
  const merged: WishChantEntry[] = [...coreTop3]
  const maxLen = Math.max(coreRest.length, contextual.length)
  for (let i = 0; i < maxLen; i++) {
    if (i < contextual.length) merged.push(contextual[i]!)
    if (i < coreRest.length) merged.push(coreRest[i]!)
  }
  return merged
}

/** 取下一条飘字咒语 */
export function pickNextWishChant(options: {
  category: WishChantCategory
  stepIndex: number
  isEn?: boolean
  critical?: boolean
}): {
  id: string
  text: string
  tone: WishChantEntry['tone']
  critical: boolean
} {
  const idx = Math.max(0, Math.floor(options.stepIndex))
  if (options.critical) {
    const entry = CRIT_WISH_CHANTS[idx % CRIT_WISH_CHANTS.length]!
    return {
      id: entry.id,
      text: options.isEn ? entry.en : entry.zh,
      tone: 'crit',
      critical: true
    }
  }
  const pool = buildWishChantPool(options.category)
  const entry = pool[idx % pool.length]!
  return {
    id: entry.id,
    text: options.isEn ? entry.en : entry.zh,
    tone: entry.tone,
    critical: false
  }
}

/** 欧气飘字档位：普通白字 / 大额橙字 / 暴击金字 */
export type WishLuckTier = 'normal' | 'big' | 'crit'

export interface WishLuckRoll {
  value: number
  tier: WishLuckTier
}

export interface WishLuckPopup extends WishLuckRoll {
  uid: number
  /** 相对角色头顶的水平起点偏移（px） */
  offsetX: number
  /** 飘散方向的水平漂移量（px），正数向右 */
  driftX: number
  /** 初始倾角（deg），模拟伤害数字的随机甩出 */
  tilt: number
  durationMs: number
}

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

/**
 * 像游戏伤害数字一样随机掷出一次欧气增量。
 * - 被动（祈愿进行中自动飘）：大多 1–99，约 12% 大额 100–520，约 3% 暴击 666–2333
 * - 点击祈福（boost）：暴击率提升到约 28%，暴击 888–9999，普通 20–199
 */
export function rollLuckGain(options: { boost?: boolean; rng?: () => number } = {}): WishLuckRoll {
  const rng = options.rng ?? Math.random
  const r = rng()
  if (options.boost) {
    if (r < 0.28) return { value: randInt(rng, 888, 9999), tier: 'crit' }
    if (r < 0.6) return { value: randInt(rng, 200, 777), tier: 'big' }
    return { value: randInt(rng, 20, 199), tier: 'normal' }
  }
  if (r < 0.03) return { value: randInt(rng, 666, 2333), tier: 'crit' }
  if (r < 0.15) return { value: randInt(rng, 100, 520), tier: 'big' }
  return { value: randInt(rng, 1, 99), tier: 'normal' }
}

/** 欧气总值展示：≥ 1 万用 1.2w / 12.3k 简写 */
export function formatLuckTotal(total: number, isEn?: boolean): string {
  const n = Math.max(0, Math.round(total))
  if (n >= 10000) {
    if (isEn) return `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k`
    return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}w`
  }
  return n.toLocaleString('en-US')
}
