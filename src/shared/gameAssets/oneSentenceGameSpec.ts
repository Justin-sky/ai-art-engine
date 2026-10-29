/**
 * 「一句话生成可玩游戏原型」的规格层（纯函数，无 DOM / Electron 依赖）。
 *
 * 两段式设计：
 * 1. 对话 Agent 把用户的一句话整理成 `GameSpec`（作为 MCP 工具 `game_one_sentence_create` 的入参）；
 *    Agent 漏填 / 填错的字段由 `normalizeGameSpec` + `inferGameSpecFromKeywords` 兜底补全；
 * 2. `buildGameGraphPlanFromSpec` 把规格**确定性地**展开为 GraphPlan（固定 key / 端口 / 参数键），
 *    模型只负责「理解需求」，连线与参数白名单由代码保证，不会连错口、丢参数。
 *
 * 范围：复用 `game.playable` 沙盒现有的 5 种玩法；超出范围的需求映射到最接近的玩法，
 * 并把映射说明写进 `scopeNotes`，由调用方如实转告用户。
 */
import type { GraphPlan, GraphPlanEdgeSpec, GraphPlanNodeSpec } from '../graph/graphPlan'
import type { GameAudioSynthPreset } from './gameAudioWavDSP'
import type { PbrMaterialPreset } from './pngCodec'
import type { LevelGeneratorAlgorithm } from './proceduralLevelMap'
import type {
  PlayableSandboxCardSpec,
  PlayableSandboxDialogueNode
} from './playableGameSandboxCompiler'
import type { UiStylePreset } from './productionAssetPipeline'

export type OneSentenceGameGenre =
  'survivor' | 'platformer' | 'tower_defense' | 'card_dbg' | 'avg_dialogue'

export type OneSentenceGameCamera = 'topdown_34' | 'topdown_90' | 'isometric_45' | 'side_view'

export type OneSentenceGameDifficulty = 'easy' | 'normal' | 'hard'

export interface GameSpec {
  title: string
  genre: OneSentenceGameGenre
  camera: OneSentenceGameCamera
  /** 统一美术风格描述（英文更利于生图模型），例如 "16-bit pixel art, dark fantasy" */
  artStyle: string
  hero: { name: string; look: string; hp: number; atk: number }
  enemy: { name: string; look: string }
  tile: { look: string; pbrPreset: PbrMaterialPreset }
  levelAlgorithm: LevelGeneratorAlgorithm
  difficulty: OneSentenceGameDifficulty
  bgm: { mood: string; synthPreset: GameAudioSynthPreset }
  sfx: { kind: string; synthPreset: GameAudioSynthPreset }
  /** 仅卡牌玩法使用 */
  cards: PlayableSandboxCardSpec[]
  /** 仅 AVG 玩法使用 */
  dialogues: PlayableSandboxDialogueNode[]
  /** 需求超出沙盒能力时的映射说明（例如「开放世界 → 割草竞技场」） */
  scopeNotes: string[]
}

/** Agent 传入的规格：除 prompt 外全部可选，且可能类型不对，统一走 normalize */
export type PartialGameSpecInput = {
  [K in keyof GameSpec]?: unknown
}

export const ONE_SENTENCE_GAME_GENRES: readonly OneSentenceGameGenre[] = [
  'survivor',
  'platformer',
  'tower_defense',
  'card_dbg',
  'avg_dialogue'
]
export const ONE_SENTENCE_GAME_CAMERAS: readonly OneSentenceGameCamera[] = [
  'topdown_34',
  'topdown_90',
  'isometric_45',
  'side_view'
]
const DIFFICULTIES: readonly OneSentenceGameDifficulty[] = ['easy', 'normal', 'hard']
const LEVEL_ALGORITHMS: readonly LevelGeneratorAlgorithm[] = [
  'bsp_dungeon',
  'cellular_cave',
  'platformer_course',
  'arena_waves',
  'tower_defense',
  'labyrinth_maze'
]
const PBR_PRESETS: readonly PbrMaterialPreset[] = [
  'stone_dungeon',
  'brushed_metal',
  'wet_mud',
  'stylized_wood',
  'gold_ornament'
]
const SYNTH_PRESETS: readonly GameAudioSynthPreset[] = [
  'sword_slash',
  'explosion',
  'laser_shoot',
  'coin_pickup',
  'jump_boost',
  'hit_hurt',
  'powerup_chord',
  'chiptune_bgm'
]

export const ONE_SENTENCE_GAME_LIMITS = {
  heroHp: { min: 20, max: 999 },
  heroAtk: { min: 1, max: 200 },
  maxCards: 12,
  maxDialogues: 16,
  maxChoices: 3,
  maxTextLength: 240
} as const

interface GenreDefaults {
  camera: OneSentenceGameCamera
  levelAlgorithm: LevelGeneratorAlgorithm
  sfxPreset: GameAudioSynthPreset
  sfxKind: string
  heroLook: string
  enemyLook: string
  tileLook: string
  tilePreset: PbrMaterialPreset
}

const GENRE_DEFAULTS: Record<OneSentenceGameGenre, GenreDefaults> = {
  survivor: {
    camera: 'topdown_34',
    levelAlgorithm: 'arena_waves',
    sfxPreset: 'sword_slash',
    sfxKind: 'sword slash hit',
    heroLook: 'brave knight with a glowing sword',
    enemyLook: 'small green slime monster',
    tileLook: 'cracked stone dungeon floor',
    tilePreset: 'stone_dungeon'
  },
  platformer: {
    camera: 'side_view',
    levelAlgorithm: 'platformer_course',
    sfxPreset: 'jump_boost',
    sfxKind: 'jump boost',
    heroLook: 'nimble adventurer in a red scarf',
    enemyLook: 'spiky beetle enemy',
    tileLook: 'grassy dirt ground block',
    tilePreset: 'wet_mud'
  },
  tower_defense: {
    camera: 'topdown_90',
    levelAlgorithm: 'tower_defense',
    sfxPreset: 'laser_shoot',
    sfxKind: 'turret laser shot',
    heroLook: 'arcane defense turret',
    enemyLook: 'marching goblin soldier',
    tileLook: 'cobblestone road tile',
    tilePreset: 'stone_dungeon'
  },
  card_dbg: {
    camera: 'topdown_34',
    levelAlgorithm: 'arena_waves',
    sfxPreset: 'hit_hurt',
    sfxKind: 'card hit impact',
    heroLook: 'young spellcaster holding a deck of cards',
    enemyLook: 'shadow demon boss',
    tileLook: 'ornate carved wood table surface',
    tilePreset: 'stylized_wood'
  },
  avg_dialogue: {
    camera: 'topdown_34',
    levelAlgorithm: 'bsp_dungeon',
    sfxPreset: 'coin_pickup',
    sfxKind: 'soft UI click',
    heroLook: 'anime-style heroine, half-body portrait',
    enemyLook: 'mysterious rival, half-body portrait',
    tileLook: 'cozy classroom background pattern',
    tilePreset: 'stylized_wood'
  }
}

const DEFAULT_ART_STYLE = '16-bit pixel art, vibrant colors, clean outlines'

/** 难度 → 沙盒手感参数（与 game.playable 的 tuning 参数一一对应） */
export const ONE_SENTENCE_DIFFICULTY_TUNING: Record<
  OneSentenceGameDifficulty,
  {
    gamePlayableEnemyAggro: number
    gamePlayableMoveSpeed: number
    gamePlayableScreenShake: number
  }
> = {
  easy: { gamePlayableEnemyAggro: 0.7, gamePlayableMoveSpeed: 1.15, gamePlayableScreenShake: 0.8 },
  normal: { gamePlayableEnemyAggro: 1.0, gamePlayableMoveSpeed: 1.0, gamePlayableScreenShake: 1.0 },
  hard: { gamePlayableEnemyAggro: 1.45, gamePlayableMoveSpeed: 0.95, gamePlayableScreenShake: 1.2 }
}

/** 一句话 → 沙盒玩法 `gamePlayableGenre` 参数值（executor 里 survivor 叫 roguelike_action） */
export function playableGenreParamForSpec(genre: OneSentenceGameGenre): string {
  return genre === 'survivor' ? 'roguelike_action' : genre
}

// ── 关键词推断（Agent 漏填字段时兜底；也是 Agent 完全不填规格时的唯一来源）──

interface KeywordRule<T> {
  value: T
  patterns: RegExp[]
}

const GENRE_RULES: KeywordRule<OneSentenceGameGenre>[] = [
  {
    value: 'tower_defense',
    patterns: [/tower\s*defen[cs]e/i, /\btd\b/i, /塔防/, /防守.*(波|塔)/] // cjk-ok
  },
  {
    value: 'card_dbg',
    patterns: [/card|deck\s*build|\bdbg\b|\bccg\b|\btcg\b/i, /卡牌|卡组|牌组|构筑|杀戮尖塔/] // cjk-ok
  },
  {
    value: 'avg_dialogue',
    patterns: [
      /visual\s*novel|\bavg\b|galgame|dating\s*sim|interactive\s*story|\bvn\b/i,
      /视觉小说|文字冒险|恋爱|剧情分支|分支剧情|互动小说|乙女|对话选项/ // cjk-ok
    ]
  },
  {
    value: 'platformer',
    patterns: [
      /platformer|side[\s-]*scroll|metroidvania|jump\s*and\s*run|mario/i,
      /横版|平台跳跃|跑酷|闯关|跳跃/ // cjk-ok
    ]
  },
  {
    value: 'survivor',
    patterns: [
      /survivor|bullet\s*heaven|roguelike|roguelite|hack\s*and\s*slash|arena|vampire/i,
      /幸存者|割草|肉鸽|地牢|弹幕|吸血鬼|竞技场|刷怪/ // cjk-ok
    ]
  }
]

const DIFFICULTY_RULES: KeywordRule<OneSentenceGameDifficulty>[] = [
  {
    value: 'hard',
    patterns: [/\bhard\b|difficult|brutal|souls/i, /难一点|困难|硬核|高难|魂系|地狱/] // cjk-ok
  },
  {
    value: 'easy',
    patterns: [/\beasy\b|casual|relax|kids?/i, /简单|休闲|轻松|容易|新手|儿童/] // cjk-ok
  }
]

const ART_STYLE_RULES: KeywordRule<string>[] = [
  {
    value: '16-bit pixel art, vibrant colors, clean outlines',
    patterns: [/pixel|8-?bit|16-?bit/i, /像素/]
  }, // cjk-ok
  {
    value: 'anime cel-shaded illustration, soft lighting',
    patterns: [/anime|manga/i, /二次元|动漫|日系/]
  }, // cjk-ok
  {
    value: 'cute chibi cartoon, thick outlines, pastel colors',
    patterns: [/cute|chibi|kawaii/i, /可爱|萌|Q版/]
  }, // cjk-ok
  {
    value: 'dark fantasy painterly, gritty, dramatic lighting',
    patterns: [/dark\s*fantasy|gothic|grim/i, /暗黑|黑暗|哥特/]
  }, // cjk-ok
  {
    value: 'neon cyberpunk, glowing accents, high contrast',
    patterns: [/cyber|neon|sci-?fi/i, /赛博|霓虹|科幻/]
  }, // cjk-ok
  {
    value: 'hand-painted watercolor, storybook style',
    patterns: [/watercolor|storybook|ink/i, /水彩|水墨|国风|手绘/]
  } // cjk-ok
]

/** 明显超出 5 种沙盒玩法能力的需求（命中则写 scopeNotes） */
const OUT_OF_SCOPE_RULES: Array<{ note: string; patterns: RegExp[] }> = [
  {
    note: 'racing → mapped to survivor arena movement',
    patterns: [/racing|kart|drift/i, /赛车|竞速|漂移/]
  }, // cjk-ok
  {
    note: 'open world → mapped to a single procedural level',
    patterns: [/open\s*world|sandbox|mmo/i, /开放世界|沙盒|大世界/]
  }, // cjk-ok
  {
    note: '3D → rendered as 2D sprites in the sandbox',
    patterns: [/\b3d\b|first[\s-]*person|fps/i, /三维|第一人称/]
  }, // cjk-ok
  {
    note: 'multiplayer → single-player prototype only',
    patterns: [/multiplayer|co-?op|pvp|online/i, /多人|联机|对战平台/]
  }, // cjk-ok
  {
    note: 'shooter / strategy depth → simplified to the closest sandbox mode',
    patterns: [/\brts\b|moba|shooter/i, /即时战略|射击/]
  } // cjk-ok
]

function firstMatch<T>(text: string, rules: KeywordRule<T>[]): T | undefined {
  for (const rule of rules) {
    if (rule.patterns.some((re) => re.test(text))) return rule.value
  }
  return undefined
}

export interface InferredGameSpecHints {
  genre: OneSentenceGameGenre
  difficulty: OneSentenceGameDifficulty
  artStyle: string
  camera: OneSentenceGameCamera
  levelAlgorithm: LevelGeneratorAlgorithm
  scopeNotes: string[]
}

/** 纯关键词推断：中英文玩法 / 难度 / 画风 / 越界说明 */
export function inferGameSpecFromKeywords(prompt: string): InferredGameSpecHints {
  const text = String(prompt ?? '')
  const genre = firstMatch(text, GENRE_RULES) ?? 'survivor'
  const difficulty = firstMatch(text, DIFFICULTY_RULES) ?? 'normal'
  const artStyle = firstMatch(text, ART_STYLE_RULES) ?? DEFAULT_ART_STYLE
  const defaults = GENRE_DEFAULTS[genre]
  let levelAlgorithm = defaults.levelAlgorithm
  if (genre === 'survivor') {
    if (/maze|labyrinth|迷宫/i.test(text))
      levelAlgorithm = 'labyrinth_maze' // cjk-ok
    else if (/cave|洞穴/i.test(text))
      levelAlgorithm = 'cellular_cave' // cjk-ok
    else if (/dungeon|地牢/i.test(text)) levelAlgorithm = 'bsp_dungeon' // cjk-ok
  }
  let camera = defaults.camera
  if (genre !== 'platformer' && /isometric|等轴|斜45/i.test(text)) camera = 'isometric_45' // cjk-ok
  const scopeNotes = OUT_OF_SCOPE_RULES.filter((rule) =>
    rule.patterns.some((re) => re.test(text))
  ).map((rule) => rule.note)
  return { genre, difficulty, artStyle, camera, levelAlgorithm, scopeNotes }
}

// ── 规格归一化 ──

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function cleanText(
  value: unknown,
  fallback: string,
  maxLen: number = ONE_SENTENCE_GAME_LIMITS.maxTextLength
): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.replace(/\s+/g, ' ').trim()
  if (!trimmed) return fallback
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

function normalizeCards(raw: unknown): PlayableSandboxCardSpec[] {
  if (!Array.isArray(raw)) return []
  const out: PlayableSandboxCardSpec[] = []
  const usedIds = new Set<string>()
  for (const item of raw.slice(0, ONE_SENTENCE_GAME_LIMITS.maxCards)) {
    const row = asRecord(item)
    const name = cleanText(row.name, '', 40)
    if (!name) continue
    let id = cleanText(row.id, '', 40).replace(/[^\w-]/g, '_') || `card_${out.length + 1}`
    while (usedIds.has(id)) id = `${id}_${out.length + 1}`
    usedIds.add(id)
    const cardType = pickEnum(row.cardType, ['attack', 'skill', 'power'] as const, 'attack')
    out.push({
      id,
      name,
      cost: clampInt(row.cost, 0, 3, 1),
      cardType,
      damage: clampInt(row.damage, 0, 99, cardType === 'attack' ? 8 : 0),
      block: clampInt(row.block, 0, 99, cardType === 'skill' ? 6 : 0),
      description: cleanText(row.description, '', 120)
    })
  }
  return out
}

/**
 * 对白归一：id 去重、截断条数；choices 的 nextId 指向不存在的节点时改指向
 * 「下一个节点」（最后一个节点则回到开头），保证 AVG 剧情图永远走得通。
 */
function normalizeDialogues(raw: unknown): PlayableSandboxDialogueNode[] {
  if (!Array.isArray(raw)) return []
  const nodes: PlayableSandboxDialogueNode[] = []
  const usedIds = new Set<string>()
  for (const item of raw.slice(0, ONE_SENTENCE_GAME_LIMITS.maxDialogues)) {
    const row = asRecord(item)
    const text = cleanText(row.text, '')
    if (!text) continue
    let id = cleanText(row.id, '', 40).replace(/[^\w-]/g, '_') || `dlg_${nodes.length + 1}`
    while (usedIds.has(id)) id = `${id}_${nodes.length + 1}`
    usedIds.add(id)
    const choicesRaw = Array.isArray(row.choices) ? row.choices : []
    const choices = choicesRaw
      .slice(0, ONE_SENTENCE_GAME_LIMITS.maxChoices)
      .map((c) => {
        const cr = asRecord(c)
        return {
          label: cleanText(cr.label, '', 60),
          nextId: cleanText(cr.nextId, '', 40),
          effect: cleanText(cr.effect, '', 40) || undefined
        }
      })
      .filter((c) => c.label)
    nodes.push({
      id,
      speaker: cleanText(row.speaker, 'Narrator', 30),
      portraitEmotion: cleanText(row.portraitEmotion, '', 20) || undefined,
      text,
      choices
    })
  }
  const ids = new Set(nodes.map((n) => n.id))
  nodes.forEach((node, index) => {
    const fallbackNext = nodes[(index + 1) % nodes.length]?.id ?? node.id
    if (!node.choices || node.choices.length === 0) {
      if (nodes.length > 1) node.choices = [{ label: 'Continue', nextId: fallbackNext }]
      return
    }
    for (const choice of node.choices) {
      if (!ids.has(choice.nextId)) choice.nextId = fallbackNext
    }
  })
  return nodes
}

/**
 * 把 Agent 传入的（可能残缺 / 类型不对的）规格归一为完整 GameSpec。
 * 规则：Agent 给的合法值优先；缺失或非法 → 关键词推断 → 玩法默认值。
 */
export function normalizeGameSpec(
  input: PartialGameSpecInput | null | undefined,
  prompt: string
): GameSpec {
  const raw = input ?? {}
  const hints = inferGameSpecFromKeywords(prompt)
  const genre = pickEnum(raw.genre, ONE_SENTENCE_GAME_GENRES, hints.genre)
  const defaults = GENRE_DEFAULTS[genre]
  // 玩法被 Agent 显式改过时，镜头 / 关卡默认值跟随新玩法，而不是关键词推断出的旧玩法
  const genreChanged = genre !== hints.genre
  const camera =
    genre === 'platformer'
      ? 'side_view'
      : pickEnum(
          raw.camera,
          ONE_SENTENCE_GAME_CAMERAS.filter((c) => c !== 'side_view'),
          genreChanged ? defaults.camera : hints.camera
        )
  const levelAlgorithm =
    genre === 'platformer'
      ? 'platformer_course'
      : genre === 'tower_defense'
        ? 'tower_defense'
        : pickEnum(
            raw.levelAlgorithm,
            LEVEL_ALGORITHMS.filter((a) => a !== 'platformer_course' && a !== 'tower_defense'),
            genreChanged ? defaults.levelAlgorithm : hints.levelAlgorithm
          )

  const heroRaw = asRecord(raw.hero)
  const enemyRaw = asRecord(raw.enemy)
  const tileRaw = asRecord(raw.tile)
  const bgmRaw = asRecord(raw.bgm)
  const sfxRaw = asRecord(raw.sfx)

  const scopeNotes = [
    ...hints.scopeNotes,
    ...(Array.isArray(raw.scopeNotes)
      ? raw.scopeNotes.map((n) => cleanText(n, '', 160)).filter(Boolean)
      : [])
  ]

  const title = cleanText(raw.title, '', 60) || cleanText(prompt, 'Indie Game Prototype', 32)

  return {
    title,
    genre,
    camera,
    artStyle: cleanText(raw.artStyle, hints.artStyle, 160),
    hero: {
      name: cleanText(heroRaw.name, 'Hero', 30),
      look: cleanText(heroRaw.look, defaults.heroLook, 200),
      hp: clampInt(
        heroRaw.hp,
        ONE_SENTENCE_GAME_LIMITS.heroHp.min,
        ONE_SENTENCE_GAME_LIMITS.heroHp.max,
        100
      ),
      atk: clampInt(
        heroRaw.atk,
        ONE_SENTENCE_GAME_LIMITS.heroAtk.min,
        ONE_SENTENCE_GAME_LIMITS.heroAtk.max,
        14
      )
    },
    enemy: {
      name: cleanText(enemyRaw.name, 'Enemy', 30),
      look: cleanText(enemyRaw.look, defaults.enemyLook, 200)
    },
    tile: {
      look: cleanText(tileRaw.look, defaults.tileLook, 200),
      pbrPreset: pickEnum(tileRaw.pbrPreset, PBR_PRESETS, defaults.tilePreset)
    },
    levelAlgorithm,
    difficulty: pickEnum(raw.difficulty, DIFFICULTIES, hints.difficulty),
    bgm: {
      mood: cleanText(bgmRaw.mood, 'upbeat adventurous chiptune loop', 160),
      synthPreset: pickEnum(bgmRaw.synthPreset, SYNTH_PRESETS, 'chiptune_bgm')
    },
    sfx: {
      kind: cleanText(sfxRaw.kind, defaults.sfxKind, 160),
      synthPreset: pickEnum(
        sfxRaw.synthPreset,
        SYNTH_PRESETS.filter((p) => p !== 'chiptune_bgm'),
        defaults.sfxPreset
      )
    },
    cards: genre === 'card_dbg' ? normalizeCards(raw.cards) : [],
    dialogues: genre === 'avg_dialogue' ? normalizeDialogues(raw.dialogues) : [],
    scopeNotes: [...new Set(scopeNotes)]
  }
}

// ── 规格 → GraphPlan ──

export interface BuildGameGraphPlanOptions {
  /** 已配置音效模型：插入 asset.sfx 作为 SFX DSP 的音源；否则程序化合成 */
  aiSfx?: boolean
  /** 已配置音乐模型：插入 asset.music 作为 BGM DSP 的音源；否则程序化合成 */
  aiMusic?: boolean
}

/** 计划内固定节点 key（MCP 返回 / 测试 / 游戏卡都按它定位） */
export const ONE_SENTENCE_GAME_NODE_KEYS = {
  brief: 'brief',
  hero: 'hero_sprite',
  enemy: 'enemy_sprite',
  tile: 'tile_texture',
  tilePbr: 'tile_pbr',
  level: 'level_map',
  bgmDsp: 'bgm_dsp',
  sfxDsp: 'sfx_dsp',
  musicGen: 'bgm_source',
  sfxGen: 'sfx_source'
} as const

function cameraPromptClause(camera: OneSentenceGameCamera): string {
  switch (camera) {
    case 'side_view':
      return 'side view facing right, 2D side-scroller'
    case 'topdown_90':
      return 'top-down view from directly above'
    case 'isometric_45':
      return 'isometric 3/4 view'
    default:
      return 'three-quarter top-down view'
  }
}

/** 精灵生图提示词：统一追加纯白底 / 单体 / 无文字后缀，配合执行器的边缘泛洪抠图 */
export function buildSpritePrompt(spec: GameSpec, look: string): string {
  return [
    spec.artStyle,
    look,
    'single character, full body, centered, isolated on a plain solid white background',
    'no shadow, no text, no frame, game sprite asset',
    cameraPromptClause(spec.camera)
  ].join(', ')
}

export function buildTilePrompt(spec: GameSpec): string {
  return [
    spec.artStyle,
    spec.tile.look,
    'seamless tileable texture, flat top-down orthographic, evenly lit, no objects, no text'
  ].join(', ')
}

function briefText(spec: GameSpec): string {
  const lines = [
    `# ${spec.title}`,
    `Genre: ${spec.genre} | Camera: ${spec.camera} | Difficulty: ${spec.difficulty}`,
    `Art style: ${spec.artStyle}`,
    `Hero: ${spec.hero.name} (HP ${spec.hero.hp}, ATK ${spec.hero.atk}) — ${spec.hero.look}`,
    `Enemy: ${spec.enemy.name} — ${spec.enemy.look}`,
    `Tile: ${spec.tile.look}`,
    `Level: ${spec.levelAlgorithm}`,
    `BGM: ${spec.bgm.mood} | SFX: ${spec.sfx.kind}`
  ]
  if (spec.cards.length) lines.push(`Cards: ${spec.cards.map((c) => c.name).join(', ')}`)
  if (spec.dialogues.length) lines.push(`Dialogue nodes: ${spec.dialogues.length}`)
  if (spec.scopeNotes.length) lines.push(`Scope notes: ${spec.scopeNotes.join('; ')}`)
  return lines.join('\n')
}

/**
 * 规格 → GraphPlan（确定性）：
 * 主角 / 敌人 / 地砖三张 1:1 生图 → 专用口 in-hero / in-enemy / in-tile；
 * 关卡 Tiled JSON → in-text；BGM / SFX 两个 game.audioDsp → in-voice；
 * 检测到音频模型时再在 DSP 前面插入 asset.music / asset.sfx。
 */
export function buildGameGraphPlanFromSpec(
  spec: GameSpec,
  options: BuildGameGraphPlanOptions = {}
): GraphPlan {
  const K = ONE_SENTENCE_GAME_NODE_KEYS
  const nodes: GraphPlanNodeSpec[] = []
  const edges: GraphPlanEdgeSpec[] = []

  const spriteParams = (prompt: string): Record<string, unknown> => ({
    generateInstruction: prompt,
    generateAspectRatio: '1:1',
    generateCount: 1,
    generateTransparentBg: true
  })

  nodes.push({
    key: K.brief,
    typeId: 'note.text',
    title: 'Game Brief',
    params: { text: briefText(spec) }
  })
  nodes.push({
    key: K.hero,
    typeId: 'asset.image',
    title: `Hero · ${spec.hero.name}`,
    params: spriteParams(buildSpritePrompt(spec, spec.hero.look))
  })
  nodes.push({
    key: K.enemy,
    typeId: 'asset.image',
    title: `Enemy · ${spec.enemy.name}`,
    params: spriteParams(buildSpritePrompt(spec, spec.enemy.look))
  })
  nodes.push({
    key: K.tile,
    typeId: 'asset.image',
    title: 'Floor Tile',
    params: {
      generateInstruction: buildTilePrompt(spec),
      generateAspectRatio: '1:1',
      generateCount: 1
    }
  })
  nodes.push({
    key: K.tilePbr,
    typeId: 'game.pbrTile',
    title: 'Tile PBR',
    params: { gameTileSeamless: true, gamePbrMaterialPreset: spec.tile.pbrPreset }
  })
  nodes.push({
    key: K.level,
    typeId: 'game.levelMap',
    title: 'Level Map',
    params: {
      gameLevelAlgorithm: spec.levelAlgorithm,
      gameLevelWidth: 32,
      gameLevelHeight: 20,
      gameLevelSeed: 1000 + (hashString(spec.title) % 90000)
    }
  })
  nodes.push({
    key: K.bgmDsp,
    typeId: 'game.audioDsp',
    title: 'BGM Loop',
    params: { gameAudioDspMode: 'loop_bgm', gameAudioSynthPreset: spec.bgm.synthPreset }
  })
  nodes.push({
    key: K.sfxDsp,
    typeId: 'game.audioDsp',
    title: 'SFX Variants',
    params: { gameAudioDspMode: 'sfx_variants', gameAudioSynthPreset: spec.sfx.synthPreset }
  })

  edges.push({ from: K.tile, to: K.tilePbr, fromPort: 'out', toPort: 'in' })

  if (options.aiMusic) {
    nodes.push({
      key: K.musicGen,
      typeId: 'asset.music',
      title: 'BGM Source',
      params: {
        generateInstruction: `${spec.bgm.mood}, seamless loopable game background music, instrumental`,
        generateMusicInstrumental: true
      }
    })
    edges.push({ from: K.musicGen, to: K.bgmDsp, fromPort: 'out', toPort: 'in' })
  }
  if (options.aiSfx) {
    nodes.push({
      key: K.sfxGen,
      typeId: 'asset.sfx',
      title: 'SFX Source',
      params: {
        generateInstruction: `${spec.sfx.kind}, short punchy game sound effect`,
        generateSoundDurationSec: 1
      }
    })
    edges.push({ from: K.sfxGen, to: K.sfxDsp, fromPort: 'out', toPort: 'in' })
  }

  return { title: spec.title, nodes, edges }
}

function hashString(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * 判断用户的一句话需求是否为「生成全套游戏 UI / 界面设计工作流」（例如「生成原神风格全套UI」「帮我做一套P5风格RPG全套UI界面」）。
 */
export function isOneSentenceUiSuitePrompt(prompt: string): boolean {
  const s = String(prompt ?? '').trim()
  if (!s) return false
  return /(\bui\b|\bhud\b|全套\s*ui|ui\s*全套|游戏\s*ui|界面套装|全套界面|祈愿界面|角色界面|背包界面|ui\s*suite|ui\s*kit|interface\s*pack)/i.test(
    s
  ) // cjk-ok
}

/**
 * 根据用户的一句话提示词或美术描述，自动推断匹配的 `UiStylePreset` 主题材质风格。
 */
export function inferUiStylePresetFromPrompt(
  prompt: string,
  explicitPreset?: string
): UiStylePreset {
  if (
    explicitPreset === 'dark_iron_parchment' ||
    explicitPreset === 'royal_gold_enamel' ||
    explicitPreset === 'arcane_crystal' ||
    explicitPreset === 'cyber_holo_grid' ||
    explicitPreset === 'ink_paper_cel' ||
    explicitPreset === 'celestial_star_gold' ||
    explicitPreset === 'persona_rebel_red' ||
    explicitPreset === 'minimal_ark_tech'
  ) {
    return explicitPreset
  }
  const s = String(prompt ?? '').toLowerCase()
  if (/原神|genshin|星铁|honkai|崩坏|提瓦特|星轨|白金|二次元幻想|celestial|astral/.test(s)) {
    // cjk-ok
    return 'celestial_star_gold'
  }
  if (/p5|persona|女神异闻录|怪盗|红黑|潮酷|rebel/.test(s)) {
    // cjk-ok
    return 'persona_rebel_red'
  }
  if (/明日方舟|arknights|罗德岛|prts|极简战术|现代扁平|机能风/.test(s)) {
    // cjk-ok
    return 'minimal_ark_tech'
  }
  if (/赛博|cyber|neon|霓虹|科幻|全息|sci-?fi|holo/.test(s)) {
    // cjk-ok
    return 'cyber_holo_grid'
  }
  if (/水墨|国风|仙侠|古风|修仙|武侠|ink|wuxia|xianxia/.test(s)) {
    // cjk-ok
    return 'ink_paper_cel'
  }
  if (/皇室|皇家|黄金|圣骑|royal|paladin|enamel/.test(s)) {
    // cjk-ok
    return 'royal_gold_enamel'
  }
  if (/奥术|水晶|魔法|法师|星界|arcane|crystal|mage/.test(s)) {
    // cjk-ok
    return 'arcane_crystal'
  }
  return 'dark_iron_parchment'
}

export const ONE_SENTENCE_UI_SUITE_NODE_KEYS = {
  brief: 'ui_brief',
  gameSystem: 'ui_game_system',
  uiSplit: 'ui_split',
  uiGen: 'ui_gen',
  uiLayerSplit: 'ui_layer_split'
} as const

/**
 * 一句话生成「全套游戏 UI 工作流」（`buildUiSuiteGraphPlanFromPrompt`）：
 * 自动在画布上铺设标准高保真 AI UI 生成管线：
 * `asset.gameSystem`（系统策划案） → `ui.split`（UI界面拆分） → `ui.gen`（UI界面生成） → `image.layerSplit`（UI图层分离与九宫格/多态导出）。
 */
export function buildUiSuiteGraphPlanFromPrompt(
  prompt: string,
  options?: {
    title?: string
    stylePreset?: string
    artStyle?: string
  }
): {
  title: string
  stylePreset: UiStylePreset
  plan: GraphPlan
} {
  const stylePreset = inferUiStylePresetFromPrompt(
    `${prompt} ${options?.artStyle ?? ''}`,
    options?.stylePreset
  )
  const isGenshin = stylePreset === 'celestial_star_gold'
  const isP5 = stylePreset === 'persona_rebel_red'
  const isArk = stylePreset === 'minimal_ark_tech'

  const defaultTitle = isGenshin
    ? '原神星轨幻想全套UI' // cjk-ok
    : isP5
      ? '怪盗红黑潮酷全套UI' // cjk-ok
      : isArk
        ? '战术终端极简全套UI' // cjk-ok
        : '独立游戏全套UI工作流' // cjk-ok
  const title = (options?.title?.trim() || defaultTitle).slice(0, 48)

  const artStylePrompt =
    options?.artStyle?.trim() ||
    (isGenshin
      ? 'Genshin Impact style anime cel-shaded UI, astral gold filigree, luminous elemental glow, masterpiece'
      : isP5
        ? 'Persona 5 royal style high-contrast red and black comic cutout UI, bold ink halftone'
        : isArk
          ? 'Arknights style modern tactical sci-fi flat UI, sleek techwear, clean lighting'
          : 'high-detail fantasy game UI, clean vibrant colors, sharp silhouette')

  const K = ONE_SENTENCE_UI_SUITE_NODE_KEYS

  const nodes: GraphPlanNodeSpec[] = [
    {
      key: K.brief,
      typeId: 'note.text',
      title: `${title} · 使用说明`, // cjk-ok
      params: {
        text: [
          `# ${title}`,
          `Prompt: ${prompt}`,
          `UI Style: ${artStylePrompt}`,
          `标准管线：1) 策划案生成 → 2) UI界面拆分 → 3) UI界面生成 → 4) UI 图层分离（支持九宫格切边、拉伸预览、按钮多态生成与多引擎导出）` // cjk-ok
        ].join('\n')
      }
    },
    {
      key: K.gameSystem,
      typeId: 'asset.gameSystem',
      title: '1. 游戏系统与UI策划案', // cjk-ok
      params: {
        text: `${prompt}\n美术风格要求：${artStylePrompt}` // cjk-ok
      }
    },
    {
      key: K.uiSplit,
      typeId: 'ui.split',
      title: '2. UI 界面拆分' // cjk-ok
    },
    {
      key: K.uiGen,
      typeId: 'ui.gen',
      title: '3. UI 界面生成', // cjk-ok
      params: {
        generateTransparentBg: true
      }
    },
    {
      key: K.uiLayerSplit,
      typeId: 'image.layerSplit',
      title: '4. UI 图层分离与九宫格导出' // cjk-ok
    }
  ]

  const edges: GraphPlanEdgeSpec[] = [
    { from: K.gameSystem, to: K.uiSplit, fromPort: 'out', toPort: 'in' },
    { from: K.uiSplit, to: K.uiGen, fromPort: 'out', toPort: 'in' },
    { from: K.uiGen, to: K.uiLayerSplit, fromPort: 'out-selected', toPort: 'in' }
  ]

  return {
    title,
    stylePreset,
    plan: { title, nodes, edges }
  }
}

/**
 * MCP 工具入参 JSON Schema（属性与 GameSpec 一致，除 prompt 外全部可选）。
 * 描述用英文：会随工具列表下发给外部 Agent。
 */
export const GAME_SPEC_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    prompt: {
      type: 'string',
      description: "The user's original one-sentence game request (required, verbatim)."
    },
    title: { type: 'string', description: 'Short game title.' },
    genre: {
      type: 'string',
      enum: [...ONE_SENTENCE_GAME_GENRES],
      description:
        'survivor = top-down auto-attack horde survival; platformer = side-scrolling jump & shoot; tower_defense = build turrets on a path; card_dbg = turn-based deck-builder; avg_dialogue = branching visual novel.'
    },
    camera: { type: 'string', enum: [...ONE_SENTENCE_GAME_CAMERAS] },
    artStyle: {
      type: 'string',
      description:
        'Unified English art-style clause for all sprites, e.g. "16-bit pixel art, dark fantasy".'
    },
    hero: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        look: { type: 'string', description: 'English visual description of the hero sprite.' },
        hp: { type: 'number' },
        atk: { type: 'number' }
      }
    },
    enemy: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        look: { type: 'string', description: 'English visual description of the enemy sprite.' }
      }
    },
    tile: {
      type: 'object',
      properties: {
        look: { type: 'string', description: 'English description of the floor / ground texture.' },
        pbrPreset: { type: 'string', enum: [...PBR_PRESETS] }
      }
    },
    levelAlgorithm: { type: 'string', enum: [...LEVEL_ALGORITHMS] },
    difficulty: { type: 'string', enum: [...DIFFICULTIES] },
    bgm: {
      type: 'object',
      properties: {
        mood: { type: 'string' },
        synthPreset: { type: 'string', enum: [...SYNTH_PRESETS] }
      }
    },
    sfx: {
      type: 'object',
      properties: {
        kind: { type: 'string' },
        synthPreset: { type: 'string', enum: [...SYNTH_PRESETS] }
      }
    },
    cards: {
      type: 'array',
      description: 'card_dbg only: up to 12 cards.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          cost: { type: 'number' },
          cardType: { type: 'string', enum: ['attack', 'skill', 'power'] },
          damage: { type: 'number' },
          block: { type: 'number' },
          description: { type: 'string' }
        }
      }
    },
    dialogues: {
      type: 'array',
      description: 'avg_dialogue only: up to 16 nodes; choices[].nextId must reference a node id.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          speaker: { type: 'string' },
          portraitEmotion: { type: 'string' },
          text: { type: 'string' },
          choices: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                nextId: { type: 'string' },
                effect: { type: 'string' }
              }
            }
          }
        }
      }
    },
    scopeNotes: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Parts of the request that do not fit the 5 sandbox genres and how they were simplified.'
    }
  },
  required: ['prompt']
} as const
