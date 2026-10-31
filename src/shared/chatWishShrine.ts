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
 * - 点击祈福（boost）：暴击率提升到约 28%（随连击 combo 最高提升至 68%），暴击 888–9999，普通 20–199
 */
export function rollLuckGain(
  options: { boost?: boolean; combo?: number; rng?: () => number } = {}
): WishLuckRoll {
  const rng = options.rng ?? Math.random
  const r = rng()
  if (options.boost) {
    const comboBonus = Math.min(0.4, Math.max(0, (options.combo ?? 0) - 1) * 0.06)
    const critChance = 0.28 + comboBonus
    const bigChance = Math.min(0.88, 0.6 + comboBonus * 0.5)
    if (r < critChance) return { value: randInt(rng, 888, 9999), tier: 'crit' }
    if (r < bigChance) return { value: randInt(rng, 200, 777), tier: 'big' }
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

/* ──────────────────────────────────────────────────────────────────────────
 * 多性格祈福仙子系统（Fairy Personas · 丰富表情 · 动态动作 · 会话专属）
 * ────────────────────────────────────────────────────────────────────────── */

export type WishFairyId = 'miko' | 'astral' | 'neko' | 'muse'

export type WishFairyPose = 'pray' | 'wave' | 'cheer' | 'peek' | 'spin' | 'wand' | 'cast' | 'dance'

export type WishFairyStageAct = 'roam' | 'cast' | 'dance' | 'edge-peek' | 'spin'

export type WishFairyExpression =
  'normal' | 'wink' | 'star' | 'heart' | 'happy' | 'surprised' | 'smug' | 'teary'

export interface WishFairyPokeLine {
  zh: string
  en: string
  expression: WishFairyExpression
  pose: WishFairyPose
}

export interface WishFairyTheme {
  hairTop: string
  hairMid: string
  hairBottom: string
  hairShadeTop: string
  hairShadeBottom: string
  irisTop: string
  irisMid: string
  irisBottom: string
  irisHighlight: string
  outfitTop: string
  outfitBottom: string
  ribbonStart: string
  ribbonEnd: string
  accentColor: string
  wingColor: string
  auraGlow: string
}

export interface WishFairyPersona {
  id: WishFairyId
  nameZh: string
  nameEn: string
  titleZh: string
  titleEn: string
  personalityZh: string
  personalityEn: string
  emoji: string
  affinityCategory: WishChantCategory
  theme: WishFairyTheme
  burstSymbols: readonly string[]
  pokeLines: readonly WishFairyPokeLine[]
}

export const WISH_FAIRY_PERSONAS: readonly WishFairyPersona[] = [
  {
    id: 'miko',
    nameZh: '小祈', // cjk-ok
    nameEn: 'Koharu',
    titleZh: '🌸 绯樱巫女 · 小祈', // cjk-ok
    titleEn: '🌸 Sakura Miko · Koharu',
    personalityZh: '元气软萌 · 锦鲤附体', // cjk-ok
    personalityEn: 'Cheerful · Lucky Koi',
    emoji: '🌸',
    affinityCategory: 'general',
    theme: {
      hairTop: '#FFB7DD',
      hairMid: '#F472B6',
      hairBottom: '#A855F7',
      hairShadeTop: '#EC4899',
      hairShadeBottom: '#7E22CE',
      irisTop: '#4A044E',
      irisMid: '#DB2777',
      irisBottom: '#F472B6',
      irisHighlight: '#FCE7F3',
      outfitTop: '#FFFFFF',
      outfitBottom: '#FFE4E6',
      ribbonStart: '#FB7185',
      ribbonEnd: '#E11D48',
      accentColor: '#FACC15',
      wingColor: '#F9A8D4',
      auraGlow: 'rgba(244, 114, 182, 0.42)'
    },
    burstSymbols: ['🌸', '🔔', '✦', '♥', '⛩️'],
    pokeLines: [
      {
        zh: '🔔 叮铃铃~ 摇响神铃，欧气翻倍喵！', // cjk-ok
        en: '🔔 Ring-a-ling! Double luck incoming!',
        expression: 'wink',
        pose: 'wave'
      },
      {
        zh: '🌸 诶嘿~ 被你戳中幸运开关啦！', // cjk-ok
        en: '🌸 Ehehe~ You hit my lucky switch!',
        expression: 'heart',
        pose: 'cheer'
      },
      {
        zh: '✨ 转个圈圈~ Bug 统统退散！', // cjk-ok
        en: '✨ Twirl around~ All bugs vanish!',
        expression: 'happy',
        pose: 'spin'
      },
      {
        zh: '😳 呜哇！连戳摸头会害羞的啦~', // cjk-ok
        en: '😳 Waa! Rapid headpats make me blush~',
        expression: 'surprised',
        pose: 'peek'
      }
    ]
  },
  {
    id: 'astral',
    nameZh: '星奈', // cjk-ok
    nameEn: 'Hoshina',
    titleZh: '⭐ 星穹魔女 · 星奈', // cjk-ok
    titleEn: '⭐ Astral Witch · Hoshina',
    personalityZh: '古灵精怪 · 构图天才', // cjk-ok
    personalityEn: 'Playful Genius · Art Muse',
    emoji: '🌟',
    affinityCategory: 'image',
    theme: {
      hairTop: '#93C5FD',
      hairMid: '#818CF8',
      hairBottom: '#C084FC',
      hairShadeTop: '#6366F1',
      hairShadeBottom: '#4338CA',
      irisTop: '#1E1B4B',
      irisMid: '#6366F1',
      irisBottom: '#FBBF24',
      irisHighlight: '#FEF08A',
      outfitTop: '#EDE9FE',
      outfitBottom: '#C4B5FD',
      ribbonStart: '#8B5CF6',
      ribbonEnd: '#4F46E5',
      accentColor: '#FDE047',
      wingColor: '#A5B4FC',
      auraGlow: 'rgba(129, 140, 248, 0.45)'
    },
    burstSymbols: ['🌟', '🌙', '🔮', '✨', '🎨'],
    pokeLines: [
      {
        zh: '🌟 哼哼~ 本魔女挥杖，这张必出神图！', // cjk-ok
        en: '🌟 Hehe~ With my wand, this art will be god-tier!',
        expression: 'smug',
        pose: 'wand'
      },
      {
        zh: '🌙 别戳我魔女帽上的小星星呀~', // cjk-ok
        en: '🌙 Hey! Dont poke the star on my witch hat~',
        expression: 'surprised',
        pose: 'peek'
      },
      {
        zh: '🔮 星轨锁定！审美与细节 200% 拉满！', // cjk-ok
        en: '🔮 Starlight locked! 200% aesthetics & detail!',
        expression: 'star',
        pose: 'spin'
      },
      {
        zh: '💫 既然你这么诚心点我，就送你一道彩虹光！', // cjk-ok
        en: '💫 Since you clicked me, heres a rainbow blessing!',
        expression: 'wink',
        pose: 'cheer'
      }
    ]
  },
  {
    id: 'neko',
    nameZh: '奈奈', // cjk-ok
    nameEn: 'Nana',
    titleZh: '🐾 赛博猫娘 · 奈奈', // cjk-ok
    titleEn: '🐾 Cyber Neko · Nana',
    personalityZh: '调皮极客 · 招财省钱', // cjk-ok
    personalityEn: 'Playful Geek · Token Saver',
    emoji: '🐾',
    affinityCategory: 'code3d',
    theme: {
      hairTop: '#6EE7B7',
      hairMid: '#2DD4BF',
      hairBottom: '#0EA5E9',
      hairShadeTop: '#14B8A6',
      hairShadeBottom: '#0369A1',
      irisTop: '#064E3B',
      irisMid: '#10B981',
      irisBottom: '#34D399',
      irisHighlight: '#D1FAE5',
      outfitTop: '#ECFEFF',
      outfitBottom: '#BAE6FD',
      ribbonStart: '#10B981',
      ribbonEnd: '#0284C7',
      accentColor: '#38BDF8',
      wingColor: '#5EEAD4',
      auraGlow: 'rgba(45, 212, 191, 0.44)'
    },
    burstSymbols: ['🐾', '🪙', '⚡', '🐟', '💎'],
    pokeLines: [
      {
        zh: '🐾 喵呜！省下的 Token 记得给奈奈买小鱼干！', // cjk-ok
        en: '🐾 Meow! Spend saved tokens on dried fish for Nana!',
        expression: 'happy',
        pose: 'wave'
      },
      {
        zh: '⚡ 猫爪加速拍键盘~ 编译一把过喵！', // cjk-ok
        en: '⚡ Neko paws turbo-typing~ First-try compile!',
        expression: 'smug',
        pose: 'cheer'
      },
      {
        zh: '😻 呼噜噜…挠下巴好舒服，暴击率飙升喵！', // cjk-ok
        en: '😻 Purrrr... Chin scratches boost crit rate!',
        expression: 'heart',
        pose: 'spin'
      },
      {
        zh: '🪙 招财猫耳抖一抖，零报错零返工！', // cjk-ok
        en: '🪙 Lucky neko ears twitching: zero bugs, zero rework!',
        expression: 'wink',
        pose: 'wand'
      }
    ]
  },
  {
    id: 'muse',
    nameZh: '露露', // cjk-ok
    nameEn: 'Lulu',
    titleZh: '🍀 云端妖精 · 露露', // cjk-ok
    titleEn: '🍀 Cloud Fairy · Lulu',
    personalityZh: '温柔治愈 · 天生欧皇', // cjk-ok
    personalityEn: 'Gentle Healer · Born Lucky',
    emoji: '🍀',
    affinityCategory: 'video',
    theme: {
      hairTop: '#FDE68A',
      hairMid: '#FBBF24',
      hairBottom: '#FB923C',
      hairShadeTop: '#F59E0B',
      hairShadeBottom: '#EA580C',
      irisTop: '#78350F',
      irisMid: '#D97706',
      irisBottom: '#34D399',
      irisHighlight: '#FEF3C7',
      outfitTop: '#FFFBEB',
      outfitBottom: '#FDE68A',
      ribbonStart: '#34D399',
      ribbonEnd: '#059669',
      accentColor: '#A7F3D0',
      wingColor: '#FDE047',
      auraGlow: 'rgba(251, 191, 36, 0.44)'
    },
    burstSymbols: ['🍀', '🎬', '♪', '💛', '✨'],
    pokeLines: [
      {
        zh: '🍀 送你一朵四叶草~ 帧率丝滑不卡顿哟！', // cjk-ok
        en: '🍀 A four-leaf clover for buttery-smooth frames!',
        expression: 'happy',
        pose: 'wand'
      },
      {
        zh: '💛 嘿嘿，被你摸头啦，好运值 +999！', // cjk-ok
        en: '💛 Hehe, headpat received! Luck +999!',
        expression: 'heart',
        pose: 'cheer'
      },
      {
        zh: '♪ 啦啦啦~ 音画卡点完美对齐！', // cjk-ok
        en: '♪ La-la-la~ Audio & visuals syncing perfectly!',
        expression: 'wink',
        pose: 'spin'
      },
      {
        zh: '✨ 哇！你这一指头直接戳出金色传说啦！', // cjk-ok
        en: '✨ Wow! Your poke triggered a golden legend!',
        expression: 'star',
        pose: 'wave'
      }
    ]
  }
] as const

export const WISH_FAIRY_MAP: Readonly<Record<WishFairyId, WishFairyPersona>> = {
  miko: WISH_FAIRY_PERSONAS[0]!,
  astral: WISH_FAIRY_PERSONAS[1]!,
  neko: WISH_FAIRY_PERSONAS[2]!,
  muse: WISH_FAIRY_PERSONAS[3]!
}

function hashSessionKey(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h >>> 0)
}

/**
 * 根据当前会话（sessionId / sessionTitle / promptText）选择对应的祈福仙子：
 * - 若传入有效的 preferredId（用户手动切换），优先使用；
 * - 若有 sessionId，基于 sessionId 做确定性哈希分流，确保不同会话自动拥有不同性格的仙子且同一会话内稳定；
 * - 若无 sessionId，则按当前任务意图（生图→星奈、视频→露露、代码3D→奈奈、通用→小祈）自动匹配。
 */
export function selectWishFairyForSession(options: {
  sessionId?: string | null
  sessionTitle?: string | null
  promptText?: string | null
  preferredId?: WishFairyId | null
}): WishFairyPersona {
  if (options.preferredId && options.preferredId in WISH_FAIRY_MAP) {
    return WISH_FAIRY_MAP[options.preferredId]
  }
  const sid = (options.sessionId ?? '').trim()
  if (sid) {
    const idx = hashSessionKey(sid) % WISH_FAIRY_PERSONAS.length
    return WISH_FAIRY_PERSONAS[idx]!
  }
  const combinedText = `${options.sessionTitle ?? ''} ${options.promptText ?? ''}`.trim()
  const cat = detectWishPromptCategory(combinedText)
  if (cat === 'image') return WISH_FAIRY_MAP.astral
  if (cat === 'video') return WISH_FAIRY_MAP.muse
  if (cat === 'code3d') return WISH_FAIRY_MAP.neko
  return WISH_FAIRY_MAP.miko
}

/** 切换到下一位祈福仙子 */
export function nextWishFairyId(currentId: WishFairyId): WishFairyId {
  const idx = WISH_FAIRY_PERSONAS.findIndex((p) => p.id === currentId)
  const nextIdx = (idx + 1) % WISH_FAIRY_PERSONAS.length
  return WISH_FAIRY_PERSONAS[nextIdx]!.id
}

/** 点击仙子时获取她的专属互动台词、表情与动作姿态 */
export function pickFairyPokeReaction(options: {
  fairyId: WishFairyId
  stepIndex: number
  combo?: number
  isEn?: boolean
}): {
  text: string
  expression: WishFairyExpression
  pose: WishFairyPose
  burstSymbols: readonly string[]
} {
  const persona = WISH_FAIRY_MAP[options.fairyId] ?? WISH_FAIRY_PERSONAS[0]!
  const idx = Math.max(0, Math.floor(options.stepIndex)) % persona.pokeLines.length
  const line = persona.pokeLines[idx]!
  const combo = options.combo ?? 1
  // 连击高潮（combo >= 4）时必定露出星星眼或爱心眼并转圈或跳起魔法舞
  const expression: WishFairyExpression =
    combo >= 5 ? 'star' : combo >= 3 ? 'heart' : line.expression
  const pose: WishFairyPose =
    combo >= 5 ? 'cast' : combo === 4 ? 'dance' : combo === 3 ? 'spin' : line.pose
  return {
    text: options.isEn ? line.en : line.zh,
    expression,
    pose,
    burstSymbols: persona.burstSymbols
  }
}

export const FAIRY_STAGE_ACT_ORDER: readonly WishFairyStageAct[] = [
  'cast',
  'dance',
  'edge-peek',
  'spin',
  'roam'
] as const

export function nextFairyStageAct(current: WishFairyStageAct): WishFairyStageAct {
  const idx = FAIRY_STAGE_ACT_ORDER.indexOf(current)
  return FAIRY_STAGE_ACT_ORDER[(idx + 1) % FAIRY_STAGE_ACT_ORDER.length]!
}

const STAGE_ACT_LINES: Readonly<
  Record<
    WishFairyId,
    Readonly<
      Record<
        WishFairyStageAct,
        { zh: string; en: string; pose: WishFairyPose; expression: WishFairyExpression }
      >
    >
  >
> = {
  miko: {
    cast: {
      zh: '🪄 绯樱神乐大结界 · 万物一次成功敕令！', // cjk-ok
      en: '🪄 Grand Sakura Barrier · First-Try Success Decree!',
      pose: 'cast',
      expression: 'star'
    },
    dance: {
      zh: '💃 叮铃铃~ 巫女丰年祈福舞，欧气全开♪', // cjk-ok
      en: '💃 Ring-a-ling~ Shrine Maiden Blessing Dance♪',
      pose: 'dance',
      expression: 'happy'
    },
    'edge-peek': {
      zh: '🫣 盯——小祈躲在窗边偷偷给你塞满锦鲤好运✨', // cjk-ok
      en: '🫣 Peek~ Hiding by the window to slip you lucky koi vibes✨',
      pose: 'peek',
      expression: 'wink'
    },
    spin: {
      zh: '🌪️ 漫天樱吹雪回旋！所有报错统统退散！', // cjk-ok
      en: '🌪️ Sakura Blizzard Pirouette! All errors vanish!',
      pose: 'spin',
      expression: 'heart'
    },
    roam: {
      zh: '🌸 御币乘风巡游中，随时守护你的灵感~', // cjk-ok
      en: '🌸 Gliding on sakura winds, guarding your inspiration~',
      pose: 'pray',
      expression: 'normal'
    }
  },
  astral: {
    cast: {
      zh: '🔮 星穹十二宫大魔阵展开 · 极光神图降临！', // cjk-ok
      en: '🔮 Grand Astral Zodiac Circle · Masterpiece Summon!',
      pose: 'cast',
      expression: 'star'
    },
    dance: {
      zh: '💃 星轨华尔兹起舞♪ 构图光影灵感到位！', // cjk-ok
      en: '💃 Starlight Waltz in motion♪ Peak lighting & composition!',
      pose: 'dance',
      expression: 'smug'
    },
    'edge-peek': {
      zh: '🫣 嘘…本魔女趴在窗框边偷看你写神级 Prompt 呢🌙', // cjk-ok
      en: '🫣 Shh... Peeking from the window bezel at your god-tier prompt🌙',
      pose: 'peek',
      expression: 'wink'
    },
    spin: {
      zh: '🌪️ 银河星爆大回旋！细节拉满零崩坏！', // cjk-ok
      en: '🌪️ Galaxy Starburst Spin! Max detail, zero artifacts!',
      pose: 'spin',
      expression: 'star'
    },
    roam: {
      zh: '🌟 骑着星月魔杖巡航，算力星尘全速充能~', // cjk-ok
      en: '🌟 Cruising on my crescent staff, charging astral mana~',
      pose: 'wand',
      expression: 'normal'
    }
  },
  neko: {
    cast: {
      zh: '⚡ 赛博猫爪超频大法阵 · 零 Bug 秒编译启动！', // cjk-ok
      en: '⚡ Cyber Neko Overclock Array · Zero-Bug Instant Compile!',
      pose: 'cast',
      expression: 'star'
    },
    dance: {
      zh: '💃 喵帕斯霓虹热舞♪ Token 消耗立减 50% 喵！', // cjk-ok
      en: '💃 Neon Neko Idol Dance♪ Token cost -50% meow!',
      pose: 'dance',
      expression: 'happy'
    },
    'edge-peek': {
      zh: '🫣 喵呜~ 挂在窗口边边暗中观察，Bug 不敢靠近🐾', // cjk-ok
      en: '🫣 Meow~ Hanging on the window edge, bugs dare not approach🐾',
      pose: 'peek',
      expression: 'smug'
    },
    spin: {
      zh: '🌪️ 招财猫龙卷风大回旋！满屏金币欧气爆表！', // cjk-ok
      en: '🌪️ Lucky Neko Tornado Spin! Jackpot coins everywhere!',
      pose: 'spin',
      expression: 'heart'
    },
    roam: {
      zh: '🐾 霓虹滑板巡航中~ 随时准备抓走小 Bug！', // cjk-ok
      en: '🐾 Cruising the neon grid~ Ready to swat any bug!',
      pose: 'wave',
      expression: 'normal'
    }
  },
  muse: {
    cast: {
      zh: '🍀 森罗四叶草圣晶阵 · 丝滑成片一次过！', // cjk-ok
      en: '🍀 Grand Four-Leaf Crystal Circle · Silky One-Take Render!',
      pose: 'cast',
      expression: 'star'
    },
    dance: {
      zh: '💃 云端精灵芭蕾舞♪ 每一帧都踩在节拍上~', // cjk-ok
      en: '💃 Cloud Fairy Ballet♪ Every frame lands on the beat~',
      pose: 'dance',
      expression: 'heart'
    },
    'edge-peek': {
      zh: '🫣 呼呼~ 露露躲在窗帘边偷偷给你吹一口欧皇仙气🍀', // cjk-ok
      en: '🫣 Hehe~ Peeking from the window edge to blow lucky fairy dust🍀',
      pose: 'peek',
      expression: 'wink'
    },
    spin: {
      zh: '🌪️ 金色羽翼大回旋！天选欧皇附体！', // cjk-ok
      en: '🌪️ Golden Feather Pirouette! Blessed by pure luck!',
      pose: 'spin',
      expression: 'happy'
    },
    roam: {
      zh: '🍀 乘着四叶草微风飘呀飘，把好运洒满画布~', // cjk-ok
      en: '🍀 Floating on clover breezes, sprinkling luck across the canvas~',
      pose: 'pray',
      expression: 'normal'
    }
  }
}

export function getFairyStageActReaction(options: {
  fairyId: WishFairyId
  act: WishFairyStageAct
  isEn?: boolean
}): {
  text: string
  pose: WishFairyPose
  expression: WishFairyExpression
  burstSymbols: readonly string[]
} {
  const persona = WISH_FAIRY_MAP[options.fairyId] ?? WISH_FAIRY_PERSONAS[0]!
  const spec = STAGE_ACT_LINES[persona.id][options.act]
  return {
    text: options.isEn ? spec.en : spec.zh,
    pose: spec.pose,
    expression: spec.expression,
    burstSymbols: persona.burstSymbols
  }
}
