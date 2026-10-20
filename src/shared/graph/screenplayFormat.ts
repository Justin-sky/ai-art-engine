/**
 * 商业级剧本节点（`play.script`）结构化分析、格式规范化与样板库。
 *
 * 与 `film.workbench`（分镜拆解 / 角色场景道具提取）格式约定完全对齐：
 * - 人物设定段：`【人物小传】` / `[Character Bios]`
 * - 场次标题：`第X场 【内/外景 · 地点 - 日/夜】` 或 `SCENE X [INT./EXT. LOCATION - DAY/NIGHT]`
 * - 动作描写：`△ ...`
 * - 对白与旁白：`角色名：...` / `角色名（OS/VO）：...`
 */

export interface ScreenplayAnalysis {
  /** 场次数（按“第X场 / SCENE X / INT. / EXT.”统计，无显式场次但有正文时记为 1） */
  sceneCount: number
  /** 识别出的角色名列表（按首次出现顺序去重） */
  characters: string[]
  /** 对白 / 旁白句数 */
  dialogueCount: number
  /** △ 动作 / 画面描写段落数 */
  actionCount: number
  /** 非空白有效字数 */
  charCount: number
  /** 预估成片时长（秒）：结合对白语速（~4.2字/秒）与动作镜头节奏（~3秒/段） */
  estimatedDurationSec: number
}

/** 排除非角色名的常见剧本结构词 */
const NON_SPEAKER_LABELS = new Set([
  '人物小传',
  '角色设定',
  '人物设定',
  '核心道具',
  '场景设定',
  '故事梗概',
  '故事大纲',
  '剧名',
  '题材',
  '风格',
  '时长',
  '画幅',
  '备注',
  '提示',
  '注意',
  '地点',
  '时间',
  '人物',
  '出场人物',
  '本场人物',
  '画面',
  '镜头',
  '动作',
  '音效',
  '音乐',
  'BGM',
  'SFX',
  '字幕',
  '花字',
  '切至',
  '转场',
  '淡入',
  '淡出',
  '黑幕',
  '画外音',
  '旁白',
  '男主',
  '女主',
  'Title',
  'Genre',
  'Logline',
  'Characters',
  'Setting',
  'Location',
  'Time',
  'Action',
  'SFX',
  'Music',
  'Note',
  'Cut to',
  'Fade in',
  'Fade out'
])

const SCENE_HEADER_RE =
  /^(?:第\s*[0-9一二三四五六七八九十百千万]+\s*[场幕集]|场次\s*[0-9一二三四五六七八九十]+|SCENE\s+\d+|(?:INT|EXT|INT\.\/EXT)\b)/i

const ACTION_LINE_RE = /^(?:[△▲Δ]|\[动作\]|【动作】)\s*/

const DIALOGUE_LINE_RE =
  /^([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9_·\s]{0,14}?)(?:\s*[（(][^）)]{1,24}[）)])?\s*[：:]\s*(.+)$/

const BIO_SECTION_RE =
  /^(?:【\s*(?:人物小传|角色设定|人物设定)\s*】|\[\s*Character(?:s| Bios)?\s*\])/i
const SECTION_HEADER_RE = /^(?:【[^】]+】|\[[^\]]+\])$/

function cleanCharacterName(raw: string): string {
  return raw
    .replace(/^[-\d.*•·\s]+/, '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .trim()
}

function isValidCharacterName(name: string): boolean {
  if (!name || name.length < 1 || name.length > 12) return false
  if (NON_SPEAKER_LABELS.has(name)) return false
  if (/^(?:第.+[场幕集]|SCENE\s*\d+|Shot\s*\d+|镜头\s*\d+)$/i.test(name)) return false
  return true
}

/**
 * 实时解析剧本文本结构：统计场次、角色表、对白数、动作段数与预估成片时长。
 */
export function analyzeScreenplay(text: string): ScreenplayAnalysis {
  const raw = typeof text === 'string' ? text : ''
  const trimmed = raw.trim()
  if (!trimmed || trimmed === '…') {
    return {
      sceneCount: 0,
      characters: [],
      dialogueCount: 0,
      actionCount: 0,
      charCount: 0,
      estimatedDurationSec: 0
    }
  }

  const charCount = trimmed.replace(/\s+/g, '').length
  const lines = trimmed.split(/\r?\n/)

  let sceneCount = 0
  let dialogueCount = 0
  let actionCount = 0
  let dialogueChars = 0
  const characters: string[] = []
  const seenChars = new Set<string>()
  const addCharacter = (candidate: string): void => {
    const clean = cleanCharacterName(candidate)
    if (!isValidCharacterName(clean) || seenChars.has(clean)) return
    seenChars.add(clean)
    characters.push(clean)
  }

  let inBioSection = false

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    if (SCENE_HEADER_RE.test(line)) {
      sceneCount += 1
      inBioSection = false
      continue
    }

    if (BIO_SECTION_RE.test(line)) {
      inBioSection = true
      continue
    }

    if (SECTION_HEADER_RE.test(line)) {
      inBioSection = false
      continue
    }

    if (inBioSection) {
      // 例如："- 林晚（24岁，实习设计师）：表面温顺，实则果敢"
      const bioMatch = line.match(
        /^(?:[-•*·]|\d+[.、])?\s*([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9·]{0,10})(?:\s*[（(][^）)]*[）)])?\s*[：:—-]/
      )
      if (bioMatch?.[1]) {
        addCharacter(bioMatch[1])
      }
      continue
    }

    if (ACTION_LINE_RE.test(line)) {
      actionCount += 1
      continue
    }

    const dlgMatch = line.match(DIALOGUE_LINE_RE)
    if (dlgMatch) {
      const speaker = dlgMatch[1]!.trim()
      const spoken = dlgMatch[2]!.trim()
      if (isValidCharacterName(speaker)) {
        addCharacter(speaker)
        dialogueCount += 1
        dialogueChars += spoken.replace(/\s+/g, '').length
        continue
      }
      if (/^(?:旁白|画外音|Narrator|VO|OS)$/i.test(speaker)) {
        dialogueCount += 1
        dialogueChars += spoken.replace(/\s+/g, '').length
        continue
      }
    }
  }

  if (sceneCount === 0 && charCount > 0) {
    sceneCount = 1
  }

  // 时长估算：
  // 1) 若已有结构化对白/动作：对白按 4.2 字/秒 + 每句 0.6s 停顿；每个 △ 动作镜头按 3.2s
  // 2) 若是纯散文/梗概：按每 15 个有效字符约 1 秒成片估算
  let estimatedDurationSec = 0
  if (dialogueCount > 0 || actionCount > 0) {
    const dlgSec = dialogueChars / 4.2 + dialogueCount * 0.6
    const actSec = actionCount * 3.2
    estimatedDurationSec = Math.max(5, Math.round(dlgSec + actSec))
  } else {
    estimatedDurationSec = Math.max(5, Math.round(charCount / 15))
  }

  return {
    sceneCount,
    characters,
    dialogueCount,
    actionCount,
    charCount,
    estimatedDurationSec
  }
}

/**
 * 一键规范化剧本排版：
 * 1. 统一场次标题空格（如 `第 1 场` → `第1场`）
 * 2. 统一动作标记（`▲` / `Δ` / `[动作]` / `【动作】` → `△ `）
 * 3. 统一对白行括号与冒号（`林晚(OS): 台词` → `林晚（OS）：台词`）
 * 4. 场次标题前自动留空行，压缩连续多余空行
 */
export function formatScreenplayText(text: string): string {
  const raw = typeof text === 'string' ? text : ''
  if (!raw.trim() || raw.trim() === '…') return raw

  const rawLines = raw.replace(/\r\n/g, '\n').split('\n')
  const outLines: string[] = []

  for (const rawLine of rawLines) {
    let line = rawLine.trim()
    if (!line) {
      if (outLines.length > 0 && outLines[outLines.length - 1] !== '') {
        outLines.push('')
      }
      continue
    }

    // 1. 规范化场次标题
    if (SCENE_HEADER_RE.test(line)) {
      line = line.replace(
        /^第\s*([0-9一二三四五六七八九十百千万]+)\s*([场幕集])\s*[:：-]?\s*/,
        '第$1$2 '
      )
      if (outLines.length > 0 && outLines[outLines.length - 1] !== '') {
        outLines.push('')
      }
      outLines.push(line)
      continue
    }

    // 2. 规范化【人物小传】等分节标题前空行
    if (SECTION_HEADER_RE.test(line)) {
      if (outLines.length > 0 && outLines[outLines.length - 1] !== '') {
        outLines.push('')
      }
      outLines.push(line)
      continue
    }

    // 3. 规范化 △ 动作标记
    if (ACTION_LINE_RE.test(line)) {
      line = `△ ${line.replace(ACTION_LINE_RE, '').trim()}`
      outLines.push(line)
      continue
    }

    // 4. 规范化中文剧本对白行标点
    const dlgMatch = line.match(
      /^([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9_·]{0,12})\s*(?:[（(]([^）)]{1,20})[）)])?\s*[：:]\s*(.+)$/
    )
    if (dlgMatch) {
      const speaker = dlgMatch[1]!.trim()
      const tag = dlgMatch[2]?.trim()
      const content = dlgMatch[3]!.trim()
      const hasCjk = /[\u4e00-\u9fa5]/.test(speaker + content)
      if (hasCjk && !/^https?$/i.test(speaker)) {
        line = tag ? `${speaker}（${tag}）：${content}` : `${speaker}：${content}`
      }
    }

    outLines.push(line)
  }

  return outLines.join('\n').trim()
}

/** 生成下一场次标题片段（自动递增场次号） */
export function buildNextSceneSnippet(currentText: string, locale = 'zh-CN'): string {
  const analysis = analyzeScreenplay(currentText)
  const raw = currentText.trim()
  const hasExplicitScene = raw.split(/\r?\n/).some((line) => SCENE_HEADER_RE.test(line.trim()))
  const nextNum = hasExplicitScene ? analysis.sceneCount + 1 : 1
  if (locale.toLowerCase().startsWith('en')) {
    return `\n\nSCENE ${nextNum} [INT. LOCATION - DAY]\n△ [Action / camera framing description]\nCHARACTER: [Dialogue]\n`
  }
  return `\n\n第${nextNum}场 【内景 · 场景地点 - 日】\n△ 镜头景别与人物动作描写。\n角色名：台词内容。\n`
}

/** 生成【人物小传】标准片段 */
export function buildCharacterBioSnippet(locale = 'zh-CN'): string {
  if (locale.toLowerCase().startsWith('en')) {
    return `【Character Bios】\n- PROTAGONIST (25, Female): Sharp-witted designer in a tailored charcoal trench coat.\n- ANTAGONIST (30, Male): Cold corporate heir in a bespoke navy suit with silver-rimmed glasses.\n\n`
  }
  return `【人物小传】\n- 林晚（24岁，女）：新锐服装设计师，清冷坚韧，身着米白色风衣与丝绒长裙。\n- 顾沉（28岁，男）：集团继承人，冷静凌厉，定制深灰西装搭配金丝眼镜。\n\n`
}

/** 生成旁白/OS 行片段 */
export function buildVoiceoverSnippet(firstCharName?: string, locale = 'zh-CN'): string {
  const isEn = locale.toLowerCase().startsWith('en')
  const speaker = firstCharName?.trim() || (isEn ? 'NARRATOR' : '旁白')
  return isEn ? `\n${speaker} (OS): ` : `\n${speaker}（OS）：`
}

export interface ScreenplayTemplate {
  id: 'urbanShort' | 'suspenseTwist' | 'xianxiaFantasy' | 'scifiChase'
  textZh: string
  textEn: string
}

/** 商用影视剧本样板库（直接对齐 `film.workbench` 的人物/场景/道具提取语法） */
export const SCREENPLAY_TEMPLATES: readonly ScreenplayTemplate[] = [
  {
    id: 'urbanShort',
    textZh: `【人物小传】
- 林晚（24岁，女）：天才珠宝设计师，外表清冷坚韧，身穿简约米色风衣，佩戴一枚古董翡翠胸针。
- 苏蔓（25岁，女）：林晚的昔日同门，盛气凌人，身穿高定红色礼服。
- 陆景深（29岁，男）：拍卖行首席鉴宝师，气场沉稳矜贵，深黑色三件套西装。

第1场 【内景 · 星辰国际珠宝拍卖厅 - 夜】
△ 璀璨水晶吊灯照亮奢华展厅，中央丝绒展台上陈列着压轴拍品「星海之泪」蓝宝石项链。
△ 苏蔓手持香槟杯走到聚光灯下，目光轻蔑地扫向角落里的林晚。
苏蔓：林晚，真没想到你还敢来。今晚这件压轴作品，署的可是我的名字！
△ 林晚缓缓抬头，指尖轻触胸前的古董翡翠胸针，眼神冷静如刃。
林晚：偷走初稿的人，永远画不出暗扣里的第三道防伪星轨。
△ 陆景深手持高倍鉴宝放大镜走上展台，全场宾客瞬间屏息。
陆景深：请把展柜灯光调成紫外冷光——真正的设计师，把签名藏在了宝石切面里。`,
    textEn: `[Character Bios]
- LIN WAN (24, Female): Prodigy jewelry designer, composed and resilient, wearing a minimalist beige trench coat and an antique emerald brooch.
- SU MAN (25, Female): Lin Wan's arrogant rival, dressed in a crimson haute couture gown.
- LU JINGSHEN (29, Male): Chief appraiser of the auction house, calm and dignified in a charcoal three-piece suit.

SCENE 1 [INT. STARLIGHT JEWELRY AUCTION HALL - NIGHT]
△ Crystal chandeliers illuminate the grand hall. On the central velvet pedestal rests the "Tear of the Starry Sea" sapphire necklace.
△ Su Man steps into the spotlight with a champagne flute, casting a disdainful glance toward Lin Wan.
SU MAN: I didn't expect you to show your face here, Lin Wan. Tonight's centerpiece bears my signature!
△ Lin Wan raises her gaze calmly, fingertips brushing her antique emerald brooch.
LIN WAN: A thief who steals a first draft never knows about the third anti-counterfeit star track hidden inside the clasp.
△ Lu Jingshen steps onto the stage holding a jeweler's loupe as the crowd falls silent.
LU JINGSHEN: Switch the display lighting to ultraviolet—the true creator engraved her mark inside the sapphire facets.`
  },
  {
    id: 'suspenseTwist',
    textZh: `【人物小传】
- 陈默（32岁，男）：老练刑警，眼神锐利疲惫，身穿沾满雨水的深棕皮夹克，手持强光战术手电。
- 神秘录音人（声音）：低沉失真的电子变声。

第1场 【内景 · 钟表修理铺阁楼 - 雨夜】
△ 窗外暴雨倾盆，闪电透过百叶窗在满墙滴答作响的古董挂钟上投下斑驳条纹影。
△ 陈默推开吱呀作响的木门，强光手电扫过积灰的工作台，定格在一台正在倒转的黄铜怀表与一盘磁带录音机上。
陈默（OS）：凌晨两点十五分，所有的钟都停了，只有这枚怀表在逆时针走。
△ 陈默戴上手套按下录音机播放键，磁带齿轮缓缓转动。
神秘录音人（VO）：陈警官，当你听到这段录音时，你手里的怀表还剩十秒。别回头，先看你脚下的影子。
△ 陈默瞳孔骤缩，闪电再次亮起——地板上赫然映出两个重叠的人影！`,
    textEn: `[Character Bios]
- CHEN MO (32, Male): Veteran detective, sharp-eyed and weathered, wearing a rain-soaked dark brown leather jacket and holding a tactical flashlight.
- MYSTERY VOICE (VO): Low, distorted electronic voice.

SCENE 1 [INT. CLOCKMAKER'S ATTIC - RAINY NIGHT]
△ Heavy rain lashes the window. Lightning slices through venetian blinds, casting striped shadows across walls of ticking antique clocks.
△ Chen Mo pushes open the creaking wooden door. His flashlight beam sweeps the dusty workbench, locking onto a brass pocket watch running backward beside a cassette recorder.
CHEN MO (OS): 2:15 AM. Every clock in the room has stopped—except this pocket watch ticking counterclockwise.
△ Wearing gloves, Chen Mo presses PLAY on the cassette deck.
MYSTERY VOICE (VO): Detective Chen, by the time you hear this tape, the watch in your hand has ten seconds left. Don't turn around—look at the shadow beneath your feet.
△ Chen Mo's pupils contract as lightning flashes again—two overlapping shadows stretch across the floorboards!`
  },
  {
    id: 'xianxiaFantasy',
    textZh: `【人物小传】
- 谢云归（22岁，男）：青云宗弃徒剑修，白衣染霜，黑发高束，背负断裂的古剑「惊鸿」。
- 玄冥长老（50岁，男）：黑袍金纹，威压骇人，手持赤焰法杖。

第1场 【外景 · 断魂崖问剑台 - 黄昏】
△ 残阳如血，云海翻涌，百座悬浮石碑环绕着残破的青铜古剑台。
△ 玄冥长老凌空而立，赤焰法杖顿地，滚滚烈焰化作锁链封住四周退路。
玄冥长老：谢云归，交出惊鸿剑魄，本座可留你全尸！
△ 谢云归立于悬崖边缘，山风吹猎白衣，他右手缓缓握住背后断裂的惊鸿古剑剑柄。
谢云归：剑修宁折不弯。今日便让你看看，断剑亦能开天！
△ 嗡——断剑铮鸣，凛冽青色剑气冲天而起，将漫天火海一剑劈开！`,
    textEn: `[Character Bios]
- XIE YUNGUI (22, Male): Exiled sword cultivator in frost-stained white robes, high ponytail, carrying the shattered ancient sword "Jinghong".
- ELDER XUANMING (50, Male): Imposing master in black-and-gold robes wielding a crimson flame staff.

SCENE 1 [EXT. SOUL-SEVERING CLIFF SWORD ALTAR - DUSK]
△ A blood-red sunset burns above churning clouds. Floating stone monoliths ring an ancient bronze sword altar.
△ Elder Xuanming hovers mid-air, slamming his crimson staff to summon chains of fire sealing every escape.
ELDER XUANMING: Xie Yungui, surrender the Jinghong Sword Soul and I shall grant you a swift end!
△ Standing at the cliff's edge with wind whipping his white robes, Xie Yungui grips the hilt of the broken sword on his back.
XIE YUNGUI: A sword cultivator breaks before he bends. Watch how a shattered blade cleaves the heavens!
△ With a resonant ring, azure sword qi erupts skyward, splitting the sea of fire in two!`
  },
  {
    id: 'scifiChase',
    textZh: `【人物小传】
- 零 / ZERO（21岁，女）：义体黑客信使，银白短发，左眼闪烁蓝光神经目镜，身穿霓虹反光机能夹克，手提加密量子手提箱。
- 追猎机甲（机械）：流线型哑光黑重装无人机甲，红色扫描激光束。

第1场 【外景 · 新九龙空中磁浮高速 - 夜】
△ 漫天全息巨幅广告在酸雨中闪烁，数条磁浮车道在摩天大楼峡谷间纵横交错。
△ 零驾驶赤色重型磁浮摩托贴着护栏极速狂飙，风挡上实时跳动着量子手提箱的解密倒计时。
零（OS）：距离核心密钥上传还剩三十秒，整座城市的防卫机甲都在我身后！
△ 三台追猎机甲从高架桥上方俯冲而下，红色激光束贴着磁浮摩托尾翼擦出连串电弧火花。
零：想截住我？那就看看谁敢冲进前面的曲率通风井！
△ 零猛拉氮气增压杆，磁浮摩托喷出幽蓝尾焰，垂直俯冲进霓虹闪烁的深渊隧道！`,
    textEn: `[Character Bios]
- ZERO (21, Female): Cybernetic courier with silver-white bob hair, glowing blue neural ocular implant, neon reflective techwear jacket, carrying an encrypted quantum briefcase.
- HUNTER MECH (Droid): Matte-black heavy pursuit drone with crimson scanning lasers.

SCENE 1 [EXT. NEO-KOWLOON MAGLEV SKYWAY - NIGHT]
△ Towering holographic billboards flicker through acid rain as maglev lanes weave between megastructure canyons.
△ Zero hurtles along the guardrail on a crimson heavy maglev bike, a decryption countdown flashing across her HUD visor.
ZERO (OS): Thirty seconds until the core key uploads—and the entire city's defense grid is on my tail!
△ Three Hunter Mechs dive from the overpass above, crimson laser beams raking sparks off the bike's tailfin.
ZERO: Want to intercept me? Let's see if you dare follow me into the warp ventilation shaft!
△ Zero slams the nitro thruster; blue plasma roars from the exhaust as she dives vertically into the neon abyss!`
  }
]

export interface ScreenplaySceneOutline {
  /** 1-based 场次序号 */
  index: number
  /** 场次标题行（如 `第1场 【内景 · 星辰国际珠宝拍卖厅 - 夜】`） */
  title: string
  /** 在剧本正文中的 0-based 行号 */
  lineIndex: number
  /** 在剧本正文中的字符偏移量（用于编辑器光标跳转） */
  charOffset: number
  /** 该场次首条动作或对白摘要 */
  preview: string
}

const PURE_SCENE_HEADER_RE =
  /^(?:#+\s*)?(?:\*\*\s*)?(?:第\s*[0-9一二三四五六七八九十百千万]+\s*[场幕]|场次\s*[0-9一二三四五六七八九十]+|SCENE\s+\d+|(?:INT|EXT|INT\.\/EXT)\b)/i

const EPISODE_HEADER_RE =
  /^(?:#+\s*)?(?:\*\*\s*)?(?:【\s*第\s*[0-9一二三四五六七八九十百千万]+\s*集[^】]*】|第\s*[0-9一二三四五六七八九十百千万]+\s*集(?:\s*[:：·—-]\s*\S.*|\s+\S.*|\s*\*\*|$)|EPISODE\s+\d+(?:\b.*)?|EP\.?\s*\d+(?:\s*[:：-].*|\s*\*\*|$))/i

/**
 * 提取剧本中的场次大纲列表（用于工作台大纲导航与点击跳转）。
 */
export function extractScreenplayScenes(text: string): ScreenplaySceneOutline[] {
  const raw = typeof text === 'string' ? text : ''
  if (!raw.trim() || raw.trim() === '…') return []

  const lines = raw.split(/\r?\n/)
  const scenes: ScreenplaySceneOutline[] = []
  let charCursor = 0

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!
    const line = rawLine.trim()
    const lineOffset = charCursor
    charCursor += rawLine.length + 1

    if (!line) continue
    if (PURE_SCENE_HEADER_RE.test(line)) {
      let preview = ''
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j]!.trim()
        if (!nextLine) continue
        if (PURE_SCENE_HEADER_RE.test(nextLine) || EPISODE_HEADER_RE.test(nextLine)) break
        preview = nextLine.length > 42 ? `${nextLine.slice(0, 42)}…` : nextLine
        break
      }
      scenes.push({
        index: scenes.length + 1,
        title: line,
        lineIndex: i,
        charOffset: lineOffset,
        preview
      })
    }
  }

  return scenes
}

export interface ScreenplaySplitOptions {
  /**
   * 拆分模式：
   * - 'auto'（默认）：若检测到 >=2 个显式「第X集 / EPISODE X」标记则按集标记拆分，否则按每集场次数拆分
   * - 'markers'：按「第X集 / EPISODE X」分集标题拆分
   * - 'scenes'：按每集固定场次数（scenesPerEpisode）拆分
   */
  mode?: 'auto' | 'markers' | 'scenes'
  /** 按场次拆分时每集包含的场次数（默认 2，范围 1~20） */
  scenesPerEpisode?: number
  /** 是否在拆分出的每一集头部自动携带共享的【人物小传】与剧名（默认 true） */
  includeSharedBios?: boolean
  /** 语言环境（默认 'zh-CN'） */
  locale?: string
}

export interface ScreenplayEpisodeItem {
  /** 1-based 集序号 */
  index: number
  /** 分集标题（如 `第1集` 或 `第1集：拍卖惊变`） */
  title: string
  /** 该集完整剧本文本（可选含共享【人物小传】） */
  text: string
  /** 该集场次数 */
  sceneCount: number
  /** 预估时长（秒） */
  estimatedDurationSec: number
}

/**
 * 提取剧本顶部的共享元信息与【人物小传】区块（位于第一个第X集或第X场之前）。
 */
export function extractSharedScreenplayHeader(text: string): {
  sharedHeader: string
  bodyText: string
} {
  const raw = typeof text === 'string' ? text : ''
  const normalized = raw.replace(/\r\n/g, '\n').trim()
  if (!normalized || normalized === '…') {
    return { sharedHeader: '', bodyText: '' }
  }

  const lines = normalized.split('\n')
  const headerLines: string[] = []
  let firstContentIdx = 0

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim()
    if (EPISODE_HEADER_RE.test(trimmed) || PURE_SCENE_HEADER_RE.test(trimmed)) {
      firstContentIdx = i
      break
    }
    headerLines.push(lines[i]!)
    firstContentIdx = i + 1
  }

  const sharedHeader = headerLines.join('\n').trim()
  const bodyText = lines.slice(firstContentIdx).join('\n').trim()
  return { sharedHeader, bodyText }
}

function cleanEpisodeTitle(rawHeader: string, index: number, isEn: boolean): string {
  const clean = rawHeader
    .trim()
    .replace(/^#+\s*/, '')
    .replace(/^\*\*\s*/, '')
    .replace(/\s*\*\*$/, '')
    .replace(/^【\s*/, '')
    .replace(/\s*】$/, '')
    .trim()
  if (clean) return clean
  return isEn ? `Episode ${index}` : `第${index}集`
}

function deriveEpisodeTitleFromFirstScene(
  firstSceneLine: string,
  index: number,
  isEn: boolean
): string {
  const base = isEn ? `Episode ${index}` : `第${index}集`
  const bracketMatch = firstSceneLine.match(/【([^】]+)】|\[([^\]]+)\]/)
  const rawLoc = (bracketMatch?.[1] || bracketMatch?.[2] || '').trim()
  if (!rawLoc) return base
  const cleanedLoc = rawLoc
    .replace(/^(?:内景|外景|内外景|INT\.\/EXT\.|INT\.|EXT\.)\s*[·•-]*\s*/i, '')
    .replace(/\s*[-—·•]\s*(?:日|夜|晨|昏|黄昏|清晨|傍晚|DAY|NIGHT|DUSK|DAWN)$/i, '')
    .trim()
  return cleanedLoc ? `${base} · ${cleanedLoc}` : base
}

function prependSharedHeaderIfNeeded(
  episodeBody: string,
  sharedHeader: string,
  includeSharedBios: boolean
): string {
  const body = formatScreenplayText(episodeBody.trim())
  if (!includeSharedBios || !sharedHeader.trim()) return body
  const hasOwnBio = body.split(/\r?\n/).some((line) => BIO_SECTION_RE.test(line.trim()))
  if (hasOwnBio) return body
  return formatScreenplayText(`${sharedHeader.trim()}\n\n${body}`)
}

/**
 * 将长剧本智能拆分为多集（支持按「第X集 / EPISODE X」标记拆分，或按每集固定场次数拆分，并自动保留共享【人物小传】）。
 */
export function splitScreenplayIntoEpisodes(
  text: string,
  options: ScreenplaySplitOptions = {}
): ScreenplayEpisodeItem[] {
  const raw = typeof text === 'string' ? text : ''
  const normalized = raw.replace(/\r\n/g, '\n').trim()
  if (!normalized || normalized === '…') return []

  const mode = options.mode ?? 'auto'
  const scenesPerEpisode = Math.max(1, Math.min(20, Math.round(options.scenesPerEpisode ?? 2)))
  const includeSharedBios = options.includeSharedBios !== false
  const isEn = (options.locale ?? 'zh-CN').toLowerCase().startsWith('en')

  const { sharedHeader, bodyText } = extractSharedScreenplayHeader(normalized)
  const workingText = bodyText || normalized
  const lines = workingText.split('\n')

  // 1. 扫描显式「第X集 / EPISODE X」标记
  const markerIndices: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (EPISODE_HEADER_RE.test(lines[i]!.trim())) {
      markerIndices.push(i)
    }
  }

  const useMarkers =
    mode === 'markers' ? markerIndices.length >= 1 : mode === 'auto' && markerIndices.length >= 2

  if (useMarkers) {
    const episodes: ScreenplayEpisodeItem[] = []
    for (let m = 0; m < markerIndices.length; m++) {
      const startLine = markerIndices[m]!
      const endLine = m + 1 < markerIndices.length ? markerIndices[m + 1]! : lines.length
      const headerLine = lines[startLine]!.trim()
      const chunkBody = lines
        .slice(startLine + 1, endLine)
        .join('\n')
        .trim()
      const content = chunkBody || headerLine
      const fullText = prependSharedHeaderIfNeeded(content, sharedHeader, includeSharedBios)
      const stats = analyzeScreenplay(fullText)
      const epIndex = episodes.length + 1
      episodes.push({
        index: epIndex,
        title: cleanEpisodeTitle(headerLine, epIndex, isEn),
        text: fullText,
        sceneCount: stats.sceneCount,
        estimatedDurationSec: stats.estimatedDurationSec
      })
    }
    return episodes
  }

  // 2. 按场次标题（第X场 / SCENE X）切分
  const sceneStartIndices: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (PURE_SCENE_HEADER_RE.test(lines[i]!.trim())) {
      sceneStartIndices.push(i)
    }
  }

  if (sceneStartIndices.length >= 2) {
    const sceneBlocks: Array<{ header: string; blockText: string }> = []
    for (let s = 0; s < sceneStartIndices.length; s++) {
      const start = sceneStartIndices[s]!
      const end = s + 1 < sceneStartIndices.length ? sceneStartIndices[s + 1]! : lines.length
      const prefix = s === 0 && start > 0 ? `${lines.slice(0, start).join('\n').trim()}\n\n` : ''
      const blockText = `${prefix}${lines.slice(start, end).join('\n').trim()}`.trim()
      sceneBlocks.push({
        header: lines[start]!.trim(),
        blockText
      })
    }

    const episodes: ScreenplayEpisodeItem[] = []
    for (let i = 0; i < sceneBlocks.length; i += scenesPerEpisode) {
      const group = sceneBlocks.slice(i, i + scenesPerEpisode)
      if (!group.length) continue
      const epIndex = episodes.length + 1
      const combinedScenes = group.map((g) => g.blockText).join('\n\n')
      const fullText = prependSharedHeaderIfNeeded(combinedScenes, sharedHeader, includeSharedBios)
      const stats = analyzeScreenplay(fullText)
      episodes.push({
        index: epIndex,
        title: deriveEpisodeTitleFromFirstScene(group[0]!.header, epIndex, isEn),
        text: fullText,
        sceneCount: stats.sceneCount,
        estimatedDurationSec: stats.estimatedDurationSec
      })
    }
    return episodes
  }

  // 3. 兜底：若只有 1 场或无显式场次标题，按空行段落均分为多集（至少保留 1 集）
  const paragraphs = workingText
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)

  if (paragraphs.length >= 2 && scenesPerEpisode >= 1) {
    const chunkSize = Math.max(1, Math.ceil(paragraphs.length / Math.max(2, scenesPerEpisode)))
    const episodes: ScreenplayEpisodeItem[] = []
    for (let i = 0; i < paragraphs.length; i += chunkSize) {
      const group = paragraphs.slice(i, i + chunkSize)
      const epIndex = episodes.length + 1
      const fullText = prependSharedHeaderIfNeeded(
        group.join('\n\n'),
        sharedHeader,
        includeSharedBios
      )
      const stats = analyzeScreenplay(fullText)
      episodes.push({
        index: epIndex,
        title: isEn ? `Episode ${epIndex}` : `第${epIndex}集`,
        text: fullText,
        sceneCount: stats.sceneCount,
        estimatedDurationSec: stats.estimatedDurationSec
      })
    }
    return episodes
  }

  const singleFull = formatScreenplayText(normalized)
  const singleStats = analyzeScreenplay(singleFull)
  return [
    {
      index: 1,
      title: isEn ? 'Episode 1' : '第1集',
      text: singleFull,
      sceneCount: singleStats.sceneCount,
      estimatedDurationSec: singleStats.estimatedDurationSec
    }
  ]
}

/**
 * 仅当剧本正文中包含 >= 2 个显式「第X集 / EPISODE X」标题标记时，按标记拆分为多集；
 * 若不足 2 个标记则返回空数组（不触发按场次或段落的启发式切分）。
 */
export function splitScreenplayByExplicitEpisodeMarkers(
  text: string,
  options: Pick<ScreenplaySplitOptions, 'includeSharedBios' | 'locale'> = {}
): ScreenplayEpisodeItem[] {
  const raw = typeof text === 'string' ? text : ''
  const normalized = raw.replace(/\r\n/g, '\n').trim()
  if (!normalized || normalized === '…') return []

  const includeSharedBios = options.includeSharedBios !== false
  const isEn = (options.locale ?? 'zh-CN').toLowerCase().startsWith('en')
  const { sharedHeader, bodyText } = extractSharedScreenplayHeader(normalized)
  const workingText = bodyText || normalized
  const lines = workingText.split('\n')

  const markerIndices: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (EPISODE_HEADER_RE.test(lines[i]!.trim())) {
      markerIndices.push(i)
    }
  }
  if (markerIndices.length < 2) return []

  const episodes: ScreenplayEpisodeItem[] = []
  for (let m = 0; m < markerIndices.length; m++) {
    const startLine = markerIndices[m]!
    const endLine = m + 1 < markerIndices.length ? markerIndices[m + 1]! : lines.length
    const headerLine = lines[startLine]!.trim()
    const chunkBody = lines
      .slice(startLine + 1, endLine)
      .join('\n')
      .trim()
    const content = chunkBody || headerLine
    const fullText = prependSharedHeaderIfNeeded(content, sharedHeader, includeSharedBios)
    const stats = analyzeScreenplay(fullText)
    const epIndex = episodes.length + 1
    episodes.push({
      index: epIndex,
      title: cleanEpisodeTitle(headerLine, epIndex, isEn),
      text: fullText,
      sceneCount: stats.sceneCount,
      estimatedDurationSec: stats.estimatedDurationSec
    })
  }
  return episodes
}

/**
 * 构建「AI 续写下一集」指令提示词：携带人物小传与上一集结尾剧情脉络。
 */
export function buildNextEpisodeInstruction(
  currentEpisodeTitle: string,
  nextEpisodeIndex: number,
  locale = 'zh-CN'
): string {
  const isEn = locale.toLowerCase().startsWith('en')
  if (isEn) {
    return `Continue writing Episode ${nextEpisodeIndex} following "${currentEpisodeTitle || `Episode ${nextEpisodeIndex - 1}`}": keep the [Character Bios] block at the top, resolve the previous cliffhanger, write 2-3 high-conflict scenes using SCENE X [INT./EXT. LOCATION - DAY/NIGHT], △ camera actions, and CHARACTER: dialogue, ending with a new suspense hook.`
  }
  return `承接「${currentEpisodeTitle || `第${nextEpisodeIndex - 1}集`}」结尾悬念，续写第${nextEpisodeIndex}集完整剧本：顶部保留【人物小传】，编写 2～3 场高冲突戏（使用「第X场 【内/外景 · 地点 - 日/夜】」、「△ 动作描写」与「角色名：台词」标准格式），并在集尾埋下新的反转钩子。` // cjk-ok
}
