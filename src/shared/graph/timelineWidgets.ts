/**
 * 成片时间线「可编程动态信息图 / 排行榜组件（Motion-Graphics Widgets）」引擎
 *
 * 对标并超越 hypit-ai/hypit 的 `@hypit/ranking` (`<ranking:TierBoard>`) 与 `@hypit/html-video`：
 * - 支持 5 类爆款短视频高频动态信息图组件：
 *   1. `tier-board`：S / A / B / C / D 梯度排行榜（球员/商品/角色随口播词级锚点飞入对应等级槽位）
 *   2. `ranking-list`：Top N 倒序/正序揭晓榜（#1..#5 随口播逐条点亮揭晓）
 *   3. `vs-scoreboard`：PK 对比计分板（左右阵营比分与维度条随口播逐项弹出）
 *   4. `step-reveal`：科普分步揭示卡（Step 1 / 2 / 3 随口播进度逐张高亮展开）
 *   5. `stat-callout`：爆款数据大字弹窗卡（核心指标 + 副标题 + 趋势徽章）
 * - 支持双时间触发模式：
 *   - 显式相对秒数 `triggerSec`（相对于组件片段起点 `0..durationSec`）
 *   - 绑定台词内联语义锚点 `cueTag`（如 `cueTag: "trophy"`，由 `syncTimelineCueAnchors` 自动解析为精确词级触发时间）
 * - 双端同构渲染：
 *   - Web 预览端：60fps 实时响应式 SVG 矢量渲染（含新入场项弹簧放大高亮动效）
 *   - FFmpeg 导出端：按状态跳变时间窗自动切分为多段子图层（支持浏览器端 Canvas 预光栅化高清 PNG + 主进程 pngjs 兜底渲染）
 */

export type TimelineWidgetKind =
  'tier-board' | 'ranking-list' | 'vs-scoreboard' | 'step-reveal' | 'stat-callout'

export const TIMELINE_WIDGET_KINDS: readonly TimelineWidgetKind[] = [
  'tier-board',
  'ranking-list',
  'vs-scoreboard',
  'step-reveal',
  'stat-callout'
] as const

export function isTimelineWidgetKind(v: unknown): v is TimelineWidgetKind {
  return typeof v === 'string' && (TIMELINE_WIDGET_KINDS as readonly string[]).includes(v)
}

export type TierLevel = 'S' | 'A' | 'B' | 'C' | 'D'

export const TIER_LEVELS: readonly TierLevel[] = ['S', 'A', 'B', 'C', 'D'] as const

export const TIER_LEVEL_COLORS: Record<TierLevel, string> = {
  S: '#ef4444',
  A: '#f97316',
  B: '#eab308',
  C: '#22c55e',
  D: '#3b82f6'
}

export interface TimelineWidgetItem {
  id: string
  /** 显示名称（如 "梅西"、"旗舰款"、"Step 1: 痛点拆解"） */
  label: string
  /** 副文案 / 数值（如 "98分"、"+320%"、"S级神作"） */
  sublabel?: string
  /** 角标文案（与 sublabel 同义，兼容 UI 编辑） */
  badge?: string
  /** 可选缩略图/商品图/头像 URL（支持 data:image/... 或本地资产预览 URL，渲染为圆角封面） */
  imageUrl?: string
  /** 可选图标/Emoji 徽章（如 "🏆"、"🔥"、"💎"） */
  iconEmoji?: string
  /** 仅 tier-board：归属等级槽位（S/A/B/C/D） */
  tier?: TierLevel
  /** 仅 vs-scoreboard：归属左方('left')或右方('right') */
  side?: 'left' | 'right'
  /** 相对于组件片段起点的触发秒数（>= 0；与 cueTag 二选一或由 cueTag 自动同步填充） */
  triggerSec?: number
  /** 绑定的台词内联语义锚点（如 `@{messi}梅西@{/messi}` 中的 `"messi"`） */
  cueTag?: string
  /** 自定义徽章颜色（#RRGGBB） */
  color?: string
}

/** 预光栅化的组件状态快照（用于 FFmpeg 导出时 100% 还原系统字体与阴影） */
export interface TimelineWidgetStateSnapshot {
  startOffsetSec: number
  endOffsetSec: number
  pngDataUrl: string
}

export type TimelineWidgetTheme = 'cyber-dark' | 'neon-pop' | 'glass-light' | 'gold-luxury'

export interface TimelineWidgetConfig {
  kind: TimelineWidgetKind
  /** 组件主标题（如 "足坛历史地位 Tier 榜"、"A vs B 核心参数对决"） */
  title?: string
  /** 组件副标题或右侧角标 */
  subtitle?: string
  /** 视觉主题 */
  theme?: TimelineWidgetTheme
  /** 主题强调色（#RRGGBB） */
  accentColor?: string
  /** vs-scoreboard 左阵营名称 */
  leftTitle?: string
  /** vs-scoreboard 右阵营名称 */
  rightTitle?: string
  /** 动态子项列表 */
  items: TimelineWidgetItem[]
}

export interface TimelineWidgetPresetMeta {
  id: TimelineWidgetKind
  kind: TimelineWidgetKind
  labelZh: string
  labelEn: string
  descZh: string
  descEn: string
  defaultWidth: number
  defaultHeight: number
  defaultX: number
  defaultY: number
  defaultConfig: () => TimelineWidgetConfig
}

export type TimelineWidgetPreset = TimelineWidgetPresetMeta

export const TIMELINE_WIDGET_PRESETS: readonly TimelineWidgetPresetMeta[] = [
  {
    id: 'tier-board',
    kind: 'tier-board',
    labelZh: '梯度排行榜 (TierBoard)',
    labelEn: 'Tier Board',
    descZh: 'S/A/B/C/D 梯度榜，条目随台词 @锚点 或时间点自动飞入对应槽位',
    descEn: 'S/A/B/C/D tier board with word-cue triggered item slots',
    defaultWidth: 0.88,
    defaultHeight: 0.34,
    defaultX: 0.06,
    defaultY: 0.04,
    defaultConfig: () => ({
      kind: 'tier-board',
      title: 'TIER LIST 梯度排行',
      accentColor: '#f59e0b',
      items: [
        { id: 'w-1', label: '热门选手 A', tier: 'C', triggerSec: 0.5, color: '#22c55e' },
        { id: 'w-2', label: '王牌选手 B', tier: 'S', triggerSec: 1.8, color: '#ef4444' },
        { id: 'w-3', label: '实力选手 C', tier: 'A', triggerSec: 3.2, color: '#f97316' }
      ]
    })
  },
  {
    id: 'ranking-list',
    kind: 'ranking-list',
    labelZh: '倒序揭晓榜 (RankingList)',
    labelEn: 'Ranking List',
    descZh: 'TOP N 排行揭晓卡，随口播节奏逐条点亮揭晓',
    descEn: 'Top-N countdown reveal list',
    defaultWidth: 0.76,
    defaultHeight: 0.36,
    defaultX: 0.12,
    defaultY: 0.06,
    defaultConfig: () => ({
      kind: 'ranking-list',
      title: 'TOP 3 必看榜单',
      accentColor: '#facc15',
      items: [
        {
          id: 'r-1',
          label: 'TOP 1 · 旗舰天花板',
          sublabel: '9.9分',
          triggerSec: 2.4,
          color: '#ef4444'
        },
        {
          id: 'r-2',
          label: 'TOP 2 · 性价比之王',
          sublabel: '9.5分',
          triggerSec: 1.2,
          color: '#f97316'
        },
        {
          id: 'r-3',
          label: 'TOP 3 · 入门首选款',
          sublabel: '9.1分',
          triggerSec: 0.3,
          color: '#3b82f6'
        }
      ]
    })
  },
  {
    id: 'vs-scoreboard',
    kind: 'vs-scoreboard',
    labelZh: '红蓝 PK 计分板 (VS)',
    labelEn: 'VS Scoreboard',
    descZh: '左右阵营硬核横评 PK 板，支持按维度逐条弹出对比',
    descEn: 'Head-to-head VS comparison scoreboard',
    defaultWidth: 0.84,
    defaultHeight: 0.32,
    defaultX: 0.08,
    defaultY: 0.06,
    defaultConfig: () => ({
      kind: 'vs-scoreboard',
      title: '硬核横评 PK',
      leftTitle: '挑战者 Pro',
      rightTitle: '传统旗舰',
      accentColor: '#ef4444',
      items: [
        { id: 'v-1', label: '续航表现 +45%', side: 'left', triggerSec: 0.4, color: '#22c55e' },
        { id: 'v-2', label: '发热控制一般', side: 'right', triggerSec: 1.4, color: '#ef4444' },
        { id: 'v-3', label: '首发价格更香', side: 'left', triggerSec: 2.5, color: '#38bdf8' }
      ]
    })
  },
  {
    id: 'step-reveal',
    kind: 'step-reveal',
    labelZh: '步骤拆解卡 (StepReveal)',
    labelEn: 'Step Reveal',
    descZh: '干货教程分步揭示卡，随讲解进度逐张高亮展开',
    descEn: 'Step-by-step tutorial reveal cards',
    defaultWidth: 0.82,
    defaultHeight: 0.34,
    defaultX: 0.09,
    defaultY: 0.06,
    defaultConfig: () => ({
      kind: 'step-reveal',
      title: '核心逻辑 3 步拆解',
      accentColor: '#38bdf8',
      items: [
        { id: 's-1', label: '01 · 抓住黄金前 3 秒钩子', sublabel: 'Hook', triggerSec: 0.2 },
        { id: 's-2', label: '02 · 词级锚点自动卡点弹窗', sublabel: 'Timing', triggerSec: 1.5 },
        { id: 's-3', label: '03 · 批量裂变 100 条变体', sublabel: 'Scale', triggerSec: 2.8 }
      ]
    })
  },
  {
    id: 'stat-callout',
    kind: 'stat-callout',
    labelZh: '数据暴击卡 (StatCallout)',
    labelEn: 'Stat Callout',
    descZh: '核心增长指标大字视觉锤弹窗',
    descEn: 'High-impact metric callout card',
    defaultWidth: 0.56,
    defaultHeight: 0.22,
    defaultX: 0.22,
    defaultY: 0.12,
    defaultConfig: () => ({
      kind: 'stat-callout',
      title: '+320%',
      subtitle: '完播率与互动率飙升',
      accentColor: '#10b981',
      items: [{ id: 'c-1', label: '实测爆款转化', sublabel: 'VERIFIED', triggerSec: 0 }]
    })
  }
] as const

function escapeXml(raw: string): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}

export function normalizeTimelineWidgetConfig(raw: unknown): TimelineWidgetConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  if (!isTimelineWidgetKind(obj.kind)) return undefined
  const itemsRaw = Array.isArray(obj.items) ? obj.items : []
  const items: TimelineWidgetItem[] = itemsRaw
    .map((item, idx): TimelineWidgetItem | null => {
      if (!item || typeof item !== 'object') return null
      const it = item as Record<string, unknown>
      const label = String(it.label ?? '').trim()
      if (!label) return null
      const tierRaw = String(it.tier ?? 'S').toUpperCase()
      const tier: TierLevel = (TIER_LEVELS as readonly string[]).includes(tierRaw)
        ? (tierRaw as TierLevel)
        : 'S'
      const side: 'left' | 'right' = it.side === 'right' ? 'right' : 'left'
      const triggerSec =
        typeof it.triggerSec === 'number' && Number.isFinite(it.triggerSec)
          ? Math.max(0, round3(it.triggerSec))
          : 0
      const cueTag =
        typeof it.cueTag === 'string' && it.cueTag.trim() ? it.cueTag.trim() : undefined
      const subText =
        typeof it.sublabel === 'string' && it.sublabel.trim()
          ? it.sublabel.trim()
          : typeof it.badge === 'string' && it.badge.trim()
            ? it.badge.trim()
            : undefined
      const imageUrl =
        typeof it.imageUrl === 'string' && it.imageUrl.trim() ? it.imageUrl.trim() : undefined
      const iconEmoji =
        typeof it.iconEmoji === 'string' && it.iconEmoji.trim() ? it.iconEmoji.trim() : undefined
      return {
        id: typeof it.id === 'string' && it.id.trim() ? it.id.trim() : `item-${idx + 1}`,
        label,
        ...(subText ? { sublabel: subText, badge: subText } : {}),
        ...(imageUrl ? { imageUrl } : {}),
        ...(iconEmoji ? { iconEmoji } : {}),
        tier,
        side,
        triggerSec,
        ...(cueTag ? { cueTag } : {}),
        ...(typeof it.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(it.color.trim())
          ? { color: it.color.trim() }
          : {})
      }
    })
    .filter((x): x is TimelineWidgetItem => x !== null)

  const themeRaw = typeof obj.theme === 'string' ? obj.theme.trim() : ''
  const theme: TimelineWidgetTheme | undefined =
    themeRaw === 'cyber-dark' ||
    themeRaw === 'neon-pop' ||
    themeRaw === 'glass-light' ||
    themeRaw === 'gold-luxury'
      ? themeRaw
      : undefined

  return {
    kind: obj.kind,
    ...(typeof obj.title === 'string' ? { title: obj.title.trim() } : {}),
    ...(typeof obj.subtitle === 'string' ? { subtitle: obj.subtitle.trim() } : {}),
    ...(theme ? { theme } : {}),
    ...(typeof obj.accentColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(obj.accentColor.trim())
      ? { accentColor: obj.accentColor.trim() }
      : {}),
    ...(typeof obj.leftTitle === 'string' ? { leftTitle: obj.leftTitle.trim() } : {}),
    ...(typeof obj.rightTitle === 'string' ? { rightTitle: obj.rightTitle.trim() } : {}),
    items
  }
}

export interface TimelineWidgetTimeSlice {
  startOffsetSec: number
  endOffsetSec: number
  /** 该时间片中用来渲染组件状态的代表时间点 */
  sampleLocalSec: number
}

/**
 * 将带触发时间点的动态组件切分为状态跳变时间片序列（供 FFmpeg 导出逐段合成或预光栅化快照使用）。
 *
 * 每个非零 `triggerSec` 会切分为两段状态：
 * - `[t, min(dur, t + 0.2s)]`：卡片刚飞入的弹跳放大态（`scale(1.06)` + 高亮描边）；
 * - `[t + 0.2s, nextTrigger]`：回落稳态（`scale(1.0)`），使导出 MP4 具备真实的弹性入场呼吸感。
 */
export function computeTimelineWidgetTimeSlices(
  config: TimelineWidgetConfig,
  clipDurationSec: number
): TimelineWidgetTimeSlice[] {
  const dur = Math.max(0.1, Number(clipDurationSec) || 0.1)
  const triggers = new Set<number>([0, dur])
  const springBounceDur = 0.2
  for (const item of config.items) {
    const t = Math.max(0, Number(item.triggerSec) || 0)
    if (t >= 0 && t < dur - 0.02) {
      const rt = round3(t)
      if (rt > 0.02) triggers.add(rt)
      const settleT = round3(rt + springBounceDur)
      if (settleT < dur - 0.03) {
        triggers.add(settleT)
      }
    }
  }
  const sorted = [...triggers].sort((a, b) => a - b)
  const slices: TimelineWidgetTimeSlice[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const s = sorted[i]!
    const e = sorted[i + 1]!
    if (e - s < 0.03) continue
    slices.push({
      startOffsetSec: s,
      endOffsetSec: e,
      sampleLocalSec: round3(s + Math.min(0.08, (e - s) * 0.4))
    })
  }
  return slices.length
    ? slices
    : [{ startOffsetSec: 0, endOffsetSec: dur, sampleLocalSec: dur * 0.5 }]
}

/**
 * 生成指定局部时间 `localTimeSec`（`= playheadSec - clip.startSec`）下的动态信息图 SVG 字符串。
 */
export function buildTimelineWidgetSvgMarkup(
  config: TimelineWidgetConfig,
  localTimeSec = 9999
): string {
  const w = 800
  const h = 340
  const theme = config.theme ?? 'cyber-dark'
  const palette =
    theme === 'glass-light'
      ? {
          boardBg: '#f8fafc',
          boardOpacity: '0.94',
          slotBg: '#e2e8f0',
          cardBg: '#ffffff',
          textMain: '#0f172a',
          textSub: '#475569',
          accent: config.accentColor || '#2563eb'
        }
      : theme === 'gold-luxury'
        ? {
            boardBg: '#0c0a09',
            boardOpacity: '0.92',
            slotBg: '#1c1917',
            cardBg: '#292524',
            textMain: '#fef3c7',
            textSub: '#d6d3d1',
            accent: config.accentColor || '#f59e0b'
          }
        : theme === 'neon-pop'
          ? {
              boardBg: '#0f0720',
              boardOpacity: '0.90',
              slotBg: '#1e1035',
              cardBg: '#2e1652',
              textMain: '#ffffff',
              textSub: '#f472b6',
              accent: config.accentColor || '#ec4899'
            }
          : {
              boardBg: '#090d16',
              boardOpacity: '0.88',
              slotBg: '#0f172a',
              cardBg: '#1e293b',
              textMain: '#f8fafc',
              textSub: '#94a3b8',
              accent: config.accentColor || '#f59e0b'
            }
  const accent = palette.accent
  const activeItems = config.items.filter((it) => (it.triggerSec ?? 0) <= localTimeSec + 0.01)

  if (config.kind === 'tier-board') {
    const headerH = config.title ? 44 : 10
    const rowH = Math.floor((h - headerH - 16) / TIER_LEVELS.length)
    let rowsSvg = ''
    let clipDefs = ''
    TIER_LEVELS.forEach((lvl, idx) => {
      const y = headerH + idx * rowH
      const tierCol = TIER_LEVEL_COLORS[lvl]
      const rowItems = activeItems.filter((it) => (it.tier ?? 'S') === lvl)
      let itemsSvg = ''
      rowItems.forEach((it, itemIdx) => {
        const ix = 92 + itemIdx * 172
        const iy = y + 5
        const iw = 164
        const ih = rowH - 10
        const isJustTriggered =
          localTimeSec < 9000 &&
          localTimeSec - (it.triggerSec ?? 0) >= 0 &&
          localTimeSec - (it.triggerSec ?? 0) < 0.22
        const badgeCol = it.color || tierCol
        const borderStroke = isJustTriggered ? '#ffffff' : badgeCol
        const strokeW = isJustTriggered ? 3.5 : 1.8
        const thumbSize = Math.max(22, ih - 8)
        let avatarSvg = ''
        if (it.imageUrl) {
          const clipId = `tb-img-${idx}-${itemIdx}`
          clipDefs += `<clipPath id="${clipId}"><rect x="5" y="4" width="${thumbSize}" height="${thumbSize}" rx="6" /></clipPath>`
          avatarSvg = `<image href="${escapeXml(it.imageUrl)}" x="5" y="4" width="${thumbSize}" height="${thumbSize}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})" />`
        } else if (it.iconEmoji) {
          avatarSvg = `
            <rect x="6" y="5" width="${thumbSize - 2}" height="${thumbSize - 2}" rx="6" fill="${badgeCol}" fill-opacity="0.22" />
            <text x="${Math.round(5 + thumbSize / 2)}" y="${Math.round(ih / 2 + 6)}" text-anchor="middle" font-size="16">${escapeXml(it.iconEmoji)}</text>`
        } else {
          avatarSvg = `<circle cx="18" cy="${Math.round(ih / 2)}" r="7" fill="${badgeCol}" />`
        }
        const textX = it.imageUrl || it.iconEmoji ? thumbSize + 12 : 33
        const maxLabelChars = it.imageUrl || it.iconEmoji ? 7 : 8
        const displayLabel =
          it.imageUrl && it.iconEmoji
            ? `${it.iconEmoji} ${it.label.slice(0, maxLabelChars)}`
            : it.label.slice(0, maxLabelChars)
        const scaleTransform = isJustTriggered
          ? `translate(${ix + iw / 2}, ${iy + ih / 2}) scale(1.06) translate(${-iw / 2}, ${-ih / 2})`
          : `translate(${ix}, ${iy})`
        itemsSvg += `
          <g transform="${scaleTransform}">
            <rect width="${iw}" height="${ih}" rx="8" fill="${palette.cardBg}" stroke="${borderStroke}" stroke-width="${strokeW}" />
            ${avatarSvg}
            <text x="${textX}" y="${Math.round(ih / 2 + (it.sublabel ? 0 : 6))}" fill="${palette.textMain}" font-family="system-ui, -apple-system, 'Microsoft YaHei', sans-serif" font-size="15" font-weight="700">${escapeXml(displayLabel)}</text>
            ${it.sublabel ? `<text x="${textX}" y="${Math.round(ih / 2 + 14)}" fill="${badgeCol}" font-family="system-ui, sans-serif" font-size="11" font-weight="800">${escapeXml(it.sublabel.slice(0, 10))}</text>` : ''}
          </g>`
      })
      rowsSvg += `
        <g>
          <rect x="12" y="${y + 2}" width="68" height="${rowH - 4}" rx="7" fill="${tierCol}" />
          <text x="46" y="${y + Math.round(rowH / 2 + 8)}" text-anchor="middle" fill="#0f172a" font-family="system-ui, -apple-system, sans-serif" font-size="23" font-weight="900">${lvl}</text>
          <rect x="84" y="${y + 2}" width="${w - 96}" height="${rowH - 4}" rx="7" fill="${palette.slotBg}" fill-opacity="0.82" stroke="#334155" stroke-width="1" />
          ${itemsSvg}
        </g>`
    })

    const titleSvg = config.title
      ? `<text x="20" y="30" fill="${palette.textMain}" font-family="system-ui, -apple-system, 'Microsoft YaHei', sans-serif" font-size="19" font-weight="800" letter-spacing="1">${escapeXml(config.title)}</text>`
      : ''

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      ${clipDefs ? `<defs>${clipDefs}</defs>` : ''}
      <rect x="4" y="4" width="${w - 8}" height="${h - 8}" rx="16" fill="${palette.boardBg}" fill-opacity="${palette.boardOpacity}" stroke="${accent}" stroke-width="2" />
      ${titleSvg}
      ${rowsSvg}
    </svg>`
  }

  if (config.kind === 'ranking-list') {
    const slots = config.items.slice(0, 5)
    const headerH = 52
    const rowH = Math.floor((h - headerH - 16) / Math.max(1, slots.length))
    let rowsSvg = ''
    let clipDefs = ''
    slots.forEach((it, idx) => {
      const y = headerH + idx * rowH
      const revealed = (it.triggerSec ?? 0) <= localTimeSec + 0.01
      const isJustTriggered =
        revealed &&
        localTimeSec < 9000 &&
        localTimeSec - (it.triggerSec ?? 0) >= 0 &&
        localTimeSec - (it.triggerSec ?? 0) < 0.22
      const rankCol =
        idx === 0 ? '#ef4444' : idx === 1 ? '#f97316' : idx === 2 ? '#eab308' : '#3b82f6'
      const labelText = revealed
        ? `${it.iconEmoji ? `${it.iconEmoji} ` : ''}${it.label}`
        : '？？？ 待揭晓'
      const subText = revealed && it.sublabel ? it.sublabel : ''
      const thumbSize = Math.max(24, rowH - 18)
      let thumbSvg = ''
      let textX = 96
      if (revealed && it.imageUrl) {
        const clipId = `rk-img-${idx}`
        clipDefs += `<clipPath id="${clipId}"><rect x="90" y="${y + 9}" width="${thumbSize}" height="${thumbSize}" rx="7" /></clipPath>`
        thumbSvg = `<image href="${escapeXml(it.imageUrl)}" x="90" y="${y + 9}" width="${thumbSize}" height="${thumbSize}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})" />`
        textX = 98 + thumbSize
      }
      const cx = w / 2
      const cy = y + rowH / 2
      const groupAttr = isJustTriggered
        ? ` transform="translate(${cx}, ${cy}) scale(1.06) translate(${-cx}, ${-cy})"`
        : ''
      rowsSvg += `
        <g${groupAttr}>
          <rect x="18" y="${y + 4}" width="${w - 36}" height="${rowH - 8}" rx="10" fill="${revealed ? palette.cardBg : palette.slotBg}" fill-opacity="${revealed ? '0.95' : '0.65'}" stroke="${isJustTriggered ? '#ffffff' : revealed ? it.color || rankCol : '#334155'}" stroke-width="${isJustTriggered ? '3.2' : revealed ? '2' : '1'}" />
          <rect x="26" y="${y + 10}" width="54" height="${rowH - 20}" rx="7" fill="${rankCol}" />
          <text x="53" y="${y + Math.round(rowH / 2 + 7)}" text-anchor="middle" fill="#0f172a" font-family="system-ui, sans-serif" font-size="18" font-weight="900">#${idx + 1}</text>
          ${thumbSvg}
          <text x="${textX}" y="${y + Math.round(rowH / 2 + 7)}" fill="${revealed ? palette.textMain : '#64748b'}" font-family="system-ui, 'Microsoft YaHei', sans-serif" font-size="19" font-weight="700">${escapeXml(labelText)}</text>
          ${subText ? `<text x="${w - 38}" y="${y + Math.round(rowH / 2 + 7)}" text-anchor="end" fill="${accent}" font-family="system-ui, 'Microsoft YaHei', sans-serif" font-size="18" font-weight="800">${escapeXml(subText)}</text>` : ''}
        </g>`
    })

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      ${clipDefs ? `<defs>${clipDefs}</defs>` : ''}
      <rect x="4" y="4" width="${w - 8}" height="${h - 8}" rx="16" fill="${palette.boardBg}" fill-opacity="${palette.boardOpacity}" stroke="${accent}" stroke-width="2" />
      <text x="24" y="36" fill="${accent}" font-family="system-ui, 'Microsoft YaHei', sans-serif" font-size="22" font-weight="900">${escapeXml(config.title || 'TOP 排行榜')}</text>
      ${rowsSvg}
    </svg>`
  }

  if (config.kind === 'vs-scoreboard') {
    const leftItems = activeItems.filter((it) => it.side !== 'right')
    const rightItems = activeItems.filter((it) => it.side === 'right')
    const leftTitle = config.leftTitle || '正方 A'
    const rightTitle = config.rightTitle || '反方 B'

    let leftSvg = ''
    leftItems.slice(0, 4).forEach((it, idx) => {
      const y = 104 + idx * 52
      leftSvg += `
        <rect x="20" y="${y}" width="340" height="44" rx="8" fill="#1e293b" stroke="${it.color || '#38bdf8'}" stroke-width="2" />
        <text x="36" y="${y + 28}" fill="#f8fafc" font-family="system-ui, 'Microsoft YaHei', sans-serif" font-size="17" font-weight="700">✓ ${escapeXml(it.label)}</text>`
    })

    let rightSvg = ''
    rightItems.slice(0, 4).forEach((it, idx) => {
      const y = 104 + idx * 52
      rightSvg += `
        <rect x="440" y="${y}" width="340" height="44" rx="8" fill="#1e293b" stroke="${it.color || '#ef4444'}" stroke-width="2" />
        <text x="456" y="${y + 28}" fill="#f8fafc" font-family="system-ui, 'Microsoft YaHei', sans-serif" font-size="17" font-weight="700">⚡ ${escapeXml(it.label)}</text>`
    })

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <rect x="4" y="4" width="${w - 8}" height="${h - 8}" rx="16" fill="#090d16" fill-opacity="0.9" stroke="${accent}" stroke-width="2" />
      <rect x="20" y="20" width="330" height="64" rx="12" fill="#0284c7" />
      <text x="185" y="60" text-anchor="middle" fill="#ffffff" font-family="system-ui, 'Microsoft YaHei', sans-serif" font-size="24" font-weight="900">${escapeXml(leftTitle)} (${leftItems.length})</text>
      <circle cx="400" cy="52" r="28" fill="${accent}" />
      <text x="400" y="60" text-anchor="middle" fill="#090d16" font-family="system-ui, sans-serif" font-size="22" font-weight="900">VS</text>
      <rect x="450" y="20" width="330" height="64" rx="12" fill="#e11d48" />
      <text x="615" y="60" text-anchor="middle" fill="#ffffff" font-family="system-ui, 'Microsoft YaHei', sans-serif" font-size="24" font-weight="900">${escapeXml(rightTitle)} (${rightItems.length})</text>
      ${leftSvg}
      ${rightSvg}
    </svg>`
  }

  if (config.kind === 'step-reveal') {
    const steps = config.items.slice(0, 4)
    const headerH = 54
    const rowH = Math.floor((h - headerH - 16) / Math.max(1, steps.length))
    let stepsSvg = ''
    steps.forEach((it, idx) => {
      const y = headerH + idx * rowH
      const active = (it.triggerSec ?? 0) <= localTimeSec + 0.01
      const bg = active ? '#1e293b' : '#0f172a'
      const border = active ? it.color || accent : '#334155'
      stepsSvg += `
        <g opacity="${active ? '1' : '0.42'}">
          <rect x="20" y="${y + 4}" width="${w - 40}" height="${rowH - 8}" rx="10" fill="${bg}" stroke="${border}" stroke-width="${active ? '2.5' : '1'}" />
          <circle cx="52" cy="${y + Math.round(rowH / 2)}" r="16" fill="${active ? border : '#334155'}" />
          <text x="52" y="${y + Math.round(rowH / 2 + 6)}" text-anchor="middle" fill="#090d16" font-family="system-ui, sans-serif" font-size="16" font-weight="900">${idx + 1}</text>
          <text x="84" y="${y + Math.round(rowH / 2 + 7)}" fill="#f8fafc" font-family="system-ui, 'Microsoft YaHei', sans-serif" font-size="19" font-weight="700">${escapeXml(it.label)}</text>
          ${it.sublabel ? `<text x="${w - 40}" y="${y + Math.round(rowH / 2 + 6)}" text-anchor="end" fill="${border}" font-family="system-ui, sans-serif" font-size="15" font-weight="800">${escapeXml(it.sublabel)}</text>` : ''}
        </g>`
    })

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <rect x="4" y="4" width="${w - 8}" height="${h - 8}" rx="16" fill="#090d16" fill-opacity="0.9" stroke="${accent}" stroke-width="2" />
      <text x="24" y="36" fill="${accent}" font-family="system-ui, 'Microsoft YaHei', sans-serif" font-size="21" font-weight="900">${escapeXml(config.title || 'STEP REVEAL 知识拆解')}</text>
      ${stepsSvg}
    </svg>`
  }

  // stat-callout
  const mainMetric = config.title || activeItems[0]?.label || '+320%'
  const subMetric = config.subtitle || activeItems[0]?.sublabel || ''
  const tagText = activeItems[0]?.label || 'HIGHLIGHT'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 240" width="600" height="240">
    <rect x="6" y="6" width="588" height="228" rx="22" fill="#090d16" fill-opacity="0.92" stroke="${accent}" stroke-width="3" />
    <rect x="28" y="28" width="16" height="184" rx="8" fill="${accent}" />
    <rect x="64" y="32" width="180" height="34" rx="17" fill="${accent}" fill-opacity="0.2" />
    <text x="154" y="55" text-anchor="middle" fill="${accent}" font-family="system-ui, 'Microsoft YaHei', sans-serif" font-size="16" font-weight="800">${escapeXml(tagText.slice(0, 12))}</text>
    <text x="64" y="142" fill="#ffffff" font-family="system-ui, -apple-system, 'Microsoft YaHei', sans-serif" font-size="72" font-weight="900">${escapeXml(mainMetric)}</text>
    <text x="64" y="196" fill="#cbd5e1" font-family="system-ui, 'Microsoft YaHei', sans-serif" font-size="24" font-weight="700">${escapeXml(subMetric)}</text>
  </svg>`
}

/**
 * 构建用于 `<img>` 预览的动态信息图 SVG Data URL。
 */
export function buildTimelineWidgetSvgDataUrl(
  config: TimelineWidgetConfig,
  localTimeSec = 9999
): string {
  const svg = buildTimelineWidgetSvgMarkup(config, localTimeSec)
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}
