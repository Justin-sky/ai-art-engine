/**
 * 全品类独立游戏结构化数值配表、分支对白树与多语言本地化（CSV / JSON）纯函数层。
 *
 * 面向 RPG / 动作 / 肉鸽割草 / 卡牌构筑（DBG）/ SLG 战棋 / AVG 视觉小说：
 * 1. 统一归一化角色表（characters）、技能表（skills）、道具表（items）、卡牌表（cards）、
 *    肉鸽波次表（waves）与分支剧情对白树（dialogues），支持与工程内美术/音频资产路径双向绑定；
 * 2. 自动抽取所有名称、描述与台词文本，生成符合 Godot 4 / Unity Localization 标准規範的
 *    RFC-4180 多语言翻译表（`localization.csv`：`key,zh-CN,en-US,ja-JP`）；
 * 3. 输出各子表的独立 CSV 与总表 JSON，可直接放进游戏工程 `data/` 目录驱动数据驱动（Data-Driven）逻辑。
 */

export interface GameCharacterRow {
  id: string
  name: string
  nameEn?: string
  nameJa?: string
  role?: string
  hp: number
  mp: number
  atk: number
  def: number
  spd: number
  critRate: number
  spriteAsset?: string
  voiceAsset?: string
  description?: string
  descriptionEn?: string
  descriptionJa?: string
}

export interface GameSkillRow {
  id: string
  name: string
  nameEn?: string
  nameJa?: string
  element: string
  manaCost: number
  cooldownSec: number
  damageMultiplier: number
  vfxAsset?: string
  sfxAsset?: string
  description?: string
  descriptionEn?: string
  descriptionJa?: string
}

export interface GameItemRow {
  id: string
  name: string
  nameEn?: string
  nameJa?: string
  category: string
  rarity: 'common' | 'rare' | 'epic' | 'legendary'
  price: number
  stackLimit: number
  iconAsset?: string
  effect?: string
  effectEn?: string
  effectJa?: string
}

export interface GameCardRow {
  id: string
  name: string
  nameEn?: string
  nameJa?: string
  cost: number
  cardType: 'attack' | 'skill' | 'power' | 'curse'
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary'
  damage?: number
  block?: number
  illustAsset?: string
  frameAsset?: string
  description: string
  descriptionEn?: string
  descriptionJa?: string
}

export interface GameWaveRow {
  waveIndex: number
  durationSec: number
  spawnIntervalSec: number
  enemyId: string
  count: number
  eliteOrBossId?: string
}

export interface GameDialogueChoice {
  label: string
  labelEn?: string
  labelJa?: string
  targetId: string
  condition?: string
  setFlag?: string
}

export interface GameDialogueNode {
  id: string
  speaker: string
  speakerEn?: string
  speakerJa?: string
  portraitAsset?: string
  expression?: string
  voiceAsset?: string
  bgmAsset?: string
  text: string
  textEn?: string
  textJa?: string
  nextId?: string
  choices?: GameDialogueChoice[]
}

export interface LocalizationEntry {
  key: string
  zhCN: string
  enUS: string
  jaJP: string
}

export interface GameDataTableInput {
  tableName?: string
  genre?: string
  characters?: Partial<GameCharacterRow>[]
  skills?: Partial<GameSkillRow>[]
  items?: Partial<GameItemRow>[]
  cards?: Partial<GameCardRow>[]
  waves?: Partial<GameWaveRow>[]
  dialogues?: Partial<GameDialogueNode>[]
  extraLocalization?: LocalizationEntry[]
}

export interface GameDataTableBundle {
  schemaVersion: 1
  tableName: string
  genre: string
  characters: GameCharacterRow[]
  skills: GameSkillRow[]
  items: GameItemRow[]
  cards: GameCardRow[]
  waves: GameWaveRow[]
  dialogues: GameDialogueNode[]
  localization: LocalizationEntry[]
  /** 完整 JSON 文本 */
  jsonText: string
  /** Godot / Unity 标准多语言翻译 CSV（key,zh-CN,en-US,ja-JP） */
  localizationCsv: string
  /** 各非空数据子表的 CSV 文本映射（如 characters.csv, cards.csv） */
  tableCsvs: Record<string, string>
}

export function escapeCsvCell(value: unknown): string {
  const str = value == null ? '' : String(value)
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function rowsToCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [headers.map(escapeCsvCell).join(',')]
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvCell(row[h])).join(','))
  }
  return lines.join('\n') + '\n'
}

/**
 * 构建并归一化全品类游戏数值表、对白树与多语言本地化 CSV。
 */
export function buildGameDataTableBundle(input: GameDataTableInput): GameDataTableBundle {
  const tableName = (input.tableName || 'game_database').trim() || 'game_database'
  const genre = (input.genre || 'all-genre').trim() || 'all-genre'

  const locEntries: LocalizationEntry[] = []
  const seenKeys = new Set<string>()
  const pushLoc = (key: string, zh?: string, en?: string, ja?: string): void => {
    const cleanZh = (zh ?? '').trim()
    if (!cleanZh || seenKeys.has(key)) return
    seenKeys.add(key)
    locEntries.push({
      key,
      zhCN: cleanZh,
      enUS: (en ?? cleanZh).trim(),
      jaJP: (ja ?? cleanZh).trim()
    })
  }

  const characters: GameCharacterRow[] = (input.characters ?? []).map((c, i) => {
    const id = (c.id || `char_${String(i + 1).padStart(2, '0')}`).trim()
    const name = (c.name || `角色_${i + 1}`).trim() // cjk-ok
    const row: GameCharacterRow = {
      id,
      name,
      ...(c.nameEn ? { nameEn: c.nameEn } : {}),
      ...(c.nameJa ? { nameJa: c.nameJa } : {}),
      role: c.role || 'hero',
      hp: Math.max(1, Math.round(Number(c.hp ?? 100))),
      mp: Math.max(0, Math.round(Number(c.mp ?? 50))),
      atk: Math.max(0, Math.round(Number(c.atk ?? 15))),
      def: Math.max(0, Math.round(Number(c.def ?? 8))),
      spd: Math.max(1, Math.round(Number(c.spd ?? 10))),
      critRate: Number(Math.max(0, Math.min(1, Number(c.critRate ?? 0.1))).toFixed(2)),
      ...(c.spriteAsset ? { spriteAsset: c.spriteAsset } : {}),
      ...(c.voiceAsset ? { voiceAsset: c.voiceAsset } : {}),
      ...(c.description ? { description: c.description } : {}),
      ...(c.descriptionEn ? { descriptionEn: c.descriptionEn } : {}),
      ...(c.descriptionJa ? { descriptionJa: c.descriptionJa } : {})
    }
    pushLoc(`CHAR_${id.toUpperCase()}_NAME`, row.name, row.nameEn, row.nameJa)
    if (row.description) {
      pushLoc(
        `CHAR_${id.toUpperCase()}_DESC`,
        row.description,
        row.descriptionEn,
        row.descriptionJa
      )
    }
    return row
  })

  const skills: GameSkillRow[] = (input.skills ?? []).map((s, i) => {
    const id = (s.id || `skill_${String(i + 1).padStart(2, '0')}`).trim()
    const name = (s.name || `技能_${i + 1}`).trim() // cjk-ok
    const row: GameSkillRow = {
      id,
      name,
      ...(s.nameEn ? { nameEn: s.nameEn } : {}),
      ...(s.nameJa ? { nameJa: s.nameJa } : {}),
      element: s.element || 'physical',
      manaCost: Math.max(0, Math.round(Number(s.manaCost ?? 10))),
      cooldownSec: Math.max(0, Number(Number(s.cooldownSec ?? 3).toFixed(2))),
      damageMultiplier: Math.max(0, Number(Number(s.damageMultiplier ?? 1.5).toFixed(2))),
      ...(s.vfxAsset ? { vfxAsset: s.vfxAsset } : {}),
      ...(s.sfxAsset ? { sfxAsset: s.sfxAsset } : {}),
      ...(s.description ? { description: s.description } : {}),
      ...(s.descriptionEn ? { descriptionEn: s.descriptionEn } : {}),
      ...(s.descriptionJa ? { descriptionJa: s.descriptionJa } : {})
    }
    pushLoc(`SKILL_${id.toUpperCase()}_NAME`, row.name, row.nameEn, row.nameJa)
    if (row.description) {
      pushLoc(
        `SKILL_${id.toUpperCase()}_DESC`,
        row.description,
        row.descriptionEn,
        row.descriptionJa
      )
    }
    return row
  })

  const items: GameItemRow[] = (input.items ?? []).map((item, i) => {
    const id = (item.id || `item_${String(i + 1).padStart(2, '0')}`).trim()
    const name = (item.name || `道具_${i + 1}`).trim() // cjk-ok
    const rarity =
      item.rarity === 'rare' || item.rarity === 'epic' || item.rarity === 'legendary'
        ? item.rarity
        : 'common'
    const row: GameItemRow = {
      id,
      name,
      ...(item.nameEn ? { nameEn: item.nameEn } : {}),
      ...(item.nameJa ? { nameJa: item.nameJa } : {}),
      category: item.category || 'consumable',
      rarity,
      price: Math.max(0, Math.round(Number(item.price ?? 50))),
      stackLimit: Math.max(1, Math.round(Number(item.stackLimit ?? 99))),
      ...(item.iconAsset ? { iconAsset: item.iconAsset } : {}),
      ...(item.effect ? { effect: item.effect } : {}),
      ...(item.effectEn ? { effectEn: item.effectEn } : {}),
      ...(item.effectJa ? { effectJa: item.effectJa } : {})
    }
    pushLoc(`ITEM_${id.toUpperCase()}_NAME`, row.name, row.nameEn, row.nameJa)
    if (row.effect) {
      pushLoc(`ITEM_${id.toUpperCase()}_EFFECT`, row.effect, row.effectEn, row.effectJa)
    }
    return row
  })

  const cards: GameCardRow[] = (input.cards ?? []).map((card, i) => {
    const id = (card.id || `card_${String(i + 1).padStart(2, '0')}`).trim()
    const name = (card.name || `卡牌_${i + 1}`).trim() // cjk-ok
    const cardType =
      card.cardType === 'skill' || card.cardType === 'power' || card.cardType === 'curse'
        ? card.cardType
        : 'attack'
    const rarity =
      card.rarity === 'uncommon' || card.rarity === 'rare' || card.rarity === 'legendary'
        ? card.rarity
        : 'common'
    const description = (card.description || '造成 6 点伤害。').trim() // cjk-ok
    const row: GameCardRow = {
      id,
      name,
      ...(card.nameEn ? { nameEn: card.nameEn } : {}),
      ...(card.nameJa ? { nameJa: card.nameJa } : {}),
      cost: Math.max(0, Math.round(Number(card.cost ?? 1))),
      cardType,
      rarity,
      ...(card.damage != null ? { damage: Number(card.damage) } : {}),
      ...(card.block != null ? { block: Number(card.block) } : {}),
      ...(card.illustAsset ? { illustAsset: card.illustAsset } : {}),
      ...(card.frameAsset ? { frameAsset: card.frameAsset } : {}),
      description,
      ...(card.descriptionEn ? { descriptionEn: card.descriptionEn } : {}),
      ...(card.descriptionJa ? { descriptionJa: card.descriptionJa } : {})
    }
    pushLoc(`CARD_${id.toUpperCase()}_NAME`, row.name, row.nameEn, row.nameJa)
    pushLoc(`CARD_${id.toUpperCase()}_DESC`, row.description, row.descriptionEn, row.descriptionJa)
    return row
  })

  const waves: GameWaveRow[] = (input.waves ?? []).map((w, i) => ({
    waveIndex: Math.max(1, Math.round(Number(w.waveIndex ?? i + 1))),
    durationSec: Math.max(5, Number(w.durationSec ?? 60)),
    spawnIntervalSec: Math.max(0.1, Number(w.spawnIntervalSec ?? 1.5)),
    enemyId: (w.enemyId || 'enemy_01').trim(),
    count: Math.max(1, Math.round(Number(w.count ?? 20))),
    ...(w.eliteOrBossId ? { eliteOrBossId: w.eliteOrBossId } : {})
  }))

  const dialogues: GameDialogueNode[] = (input.dialogues ?? []).map((d, i) => {
    const id = (d.id || `dlg_${String(i + 1).padStart(3, '0')}`).trim()
    const speaker = (d.speaker || 'Narrator').trim()
    const text = (d.text || '').trim()
    const choices = Array.isArray(d.choices)
      ? d.choices.map((ch, ci) => {
          const choice: GameDialogueChoice = {
            label: (ch.label || `选项 ${ci + 1}`).trim(), // cjk-ok
            ...(ch.labelEn ? { labelEn: ch.labelEn } : {}),
            ...(ch.labelJa ? { labelJa: ch.labelJa } : {}),
            targetId: (ch.targetId || '').trim(),
            ...(ch.condition ? { condition: ch.condition } : {}),
            ...(ch.setFlag ? { setFlag: ch.setFlag } : {})
          }
          pushLoc(
            `DLG_${id.toUpperCase()}_CHOICE_${ci + 1}`,
            choice.label,
            choice.labelEn,
            choice.labelJa
          )
          return choice
        })
      : undefined

    const node: GameDialogueNode = {
      id,
      speaker,
      ...(d.speakerEn ? { speakerEn: d.speakerEn } : {}),
      ...(d.speakerJa ? { speakerJa: d.speakerJa } : {}),
      ...(d.portraitAsset ? { portraitAsset: d.portraitAsset } : {}),
      ...(d.expression ? { expression: d.expression } : {}),
      ...(d.voiceAsset ? { voiceAsset: d.voiceAsset } : {}),
      ...(d.bgmAsset ? { bgmAsset: d.bgmAsset } : {}),
      text,
      ...(d.textEn ? { textEn: d.textEn } : {}),
      ...(d.textJa ? { textJa: d.textJa } : {}),
      ...(d.nextId ? { nextId: d.nextId } : {}),
      ...(choices && choices.length ? { choices } : {})
    }
    pushLoc(`DLG_${id.toUpperCase()}_SPEAKER`, node.speaker, node.speakerEn, node.speakerJa)
    pushLoc(`DLG_${id.toUpperCase()}_TEXT`, node.text, node.textEn, node.textJa)
    return node
  })

  for (const extra of input.extraLocalization ?? []) {
    pushLoc(extra.key, extra.zhCN, extra.enUS, extra.jaJP)
  }

  const localizationCsv = rowsToCsv(
    ['key', 'zh-CN', 'en-US', 'ja-JP'],
    locEntries.map((e) => ({
      key: e.key,
      'zh-CN': e.zhCN,
      'en-US': e.enUS,
      'ja-JP': e.jaJP
    }))
  )

  const tableCsvs: Record<string, string> = {}
  if (characters.length) {
    tableCsvs['characters.csv'] = rowsToCsv(
      [
        'id',
        'name',
        'role',
        'hp',
        'mp',
        'atk',
        'def',
        'spd',
        'critRate',
        'spriteAsset',
        'voiceAsset',
        'description'
      ],
      characters as unknown as Array<Record<string, unknown>>
    )
  }
  if (skills.length) {
    tableCsvs['skills.csv'] = rowsToCsv(
      [
        'id',
        'name',
        'element',
        'manaCost',
        'cooldownSec',
        'damageMultiplier',
        'vfxAsset',
        'sfxAsset',
        'description'
      ],
      skills as unknown as Array<Record<string, unknown>>
    )
  }
  if (items.length) {
    tableCsvs['items.csv'] = rowsToCsv(
      ['id', 'name', 'category', 'rarity', 'price', 'stackLimit', 'iconAsset', 'effect'],
      items as unknown as Array<Record<string, unknown>>
    )
  }
  if (cards.length) {
    tableCsvs['cards.csv'] = rowsToCsv(
      [
        'id',
        'name',
        'cost',
        'cardType',
        'rarity',
        'damage',
        'block',
        'illustAsset',
        'frameAsset',
        'description'
      ],
      cards as unknown as Array<Record<string, unknown>>
    )
  }
  if (waves.length) {
    tableCsvs['waves.csv'] = rowsToCsv(
      ['waveIndex', 'durationSec', 'spawnIntervalSec', 'enemyId', 'count', 'eliteOrBossId'],
      waves as unknown as Array<Record<string, unknown>>
    )
  }

  const payload = {
    schemaVersion: 1 as const,
    tableName,
    genre,
    characters,
    skills,
    items,
    cards,
    waves,
    dialogues,
    localization: locEntries
  }

  return {
    ...payload,
    jsonText: JSON.stringify(payload, null, 2),
    localizationCsv,
    tableCsvs
  }
}
