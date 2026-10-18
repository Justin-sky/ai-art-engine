import type {
  PresetCameraMotion,
  PresetFacing,
  PresetLighting,
  PresetMood,
  PresetShotSize,
  PresetVisual
} from '@shared/graph/presetVisual'

const C_STROKE = 'currentColor'
const C_MUTED = 'color-mix(in srgb, currentColor 42%, transparent)'
const C_FAINT = 'color-mix(in srgb, currentColor 14%, transparent)'
const C_ACCENT = 'var(--accent, #5b8def)'
const C_ACCENT_SOFT = 'color-mix(in srgb, var(--accent, #5b8def) 24%, transparent)'
const C_ACCENT_MID = 'color-mix(in srgb, var(--accent, #5b8def) 48%, transparent)'

function wrapSvg(inner: string, key: string): string {
  return `<svg class="schematic-svg" data-schematic="${key}" viewBox="0 0 120 52" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${inner}</svg>`
}

/** 标准画幅外框 + 四角取景器准星 */
function viewfinderFrame(x = 14, y = 6, w = 92, h = 40): string {
  const r = 4
  const c = 6
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" stroke="${C_MUTED}" stroke-width="1.2" fill="${C_FAINT}" />
    <path d="M${x} ${y + c}V${y + 2}Q${x} ${y} ${x + 2} ${y}H${x + c}" stroke="${C_ACCENT}" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M${x + w - c} ${y}H${x + w - 2}Q${x + w} ${y} ${x + w} ${y + 2}V${y + c}" stroke="${C_ACCENT}" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M${x} ${y + h - c}V${y + h - 2}Q${x} ${y + h} ${x + 2} ${y + h}H${x + c}" stroke="${C_ACCENT}" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M${x + w - c} ${y + h}H${x + w - 2}Q${x + w} ${y + h} ${x + w} ${y + h - 2}V${y + h - c}" stroke="${C_ACCENT}" stroke-width="1.5" stroke-linecap="round"/>
  `
}

/** 人物半身/全身剪影（cx, cy 为头顶中心，scale 缩放） */
function personSilhouette(cx: number, cy: number, scale = 1, accent = true): string {
  const hr = 4.5 * scale
  const bw = 13 * scale
  const bh = 16 * scale
  const fill = accent ? C_ACCENT_SOFT : C_FAINT
  const stroke = accent ? C_ACCENT : C_STROKE
  return `
    <circle cx="${cx}" cy="${cy + hr}" r="${hr}" fill="${fill}" stroke="${stroke}" stroke-width="1.4" />
    <path d="M${cx - bw / 2} ${cy + hr * 2 + 2 + bh} C${cx - bw / 2} ${cy + hr * 2 + 2} ${cx + bw / 2} ${cy + hr * 2 + 2} ${cx + bw / 2} ${cy + hr * 2 + 2 + bh} Z" fill="${fill}" stroke="${stroke}" stroke-width="1.4" stroke-linejoin="round" />
  `
}

/** 关节骨架小人（用于 3D 姿势 / 3D 动画 / 2D 帧动画角色动作） */
function renderPoseSkeleton(pose: string, animated = false): string {
  const ground = `<line x1="22" y1="46" x2="98" y2="46" stroke="${C_MUTED}" stroke-width="1" stroke-dasharray="3 2" />`
  const animBadge = animated
    ? `<g>
        <path d="M90 10 A7 7 0 1 1 84 19" stroke="${C_ACCENT}" stroke-width="1.4" stroke-linecap="round" />
        <polyline points="88,7 91,10 87,12" stroke="${C_ACCENT}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
        <line x1="20" y1="49" x2="100" y2="49" stroke="${C_ACCENT_MID}" stroke-width="1.5" />
        <circle cx="38" cy="49" r="2" fill="${C_ACCENT}" />
        <circle cx="60" cy="49" r="2" fill="${C_ACCENT}" />
        <circle cx="82" cy="49" r="2" fill="${C_ACCENT}" />
      </g>`
    : ''

  type SkeletonSpec = {
    head: [number, number]
    neck: [number, number]
    hip: [number, number]
    lHand: [number, number]
    rHand: [number, number]
    lFoot: [number, number]
    rFoot: [number, number]
    extra?: string
  }

  const P: Record<string, SkeletonSpec> = {
    idle: {
      head: [60, 12],
      neck: [60, 18],
      hip: [60, 31],
      lHand: [51, 29],
      rHand: [69, 29],
      lFoot: [55, 45],
      rFoot: [65, 45]
    },
    walk: {
      head: [60, 12],
      neck: [60, 18],
      hip: [59, 31],
      lHand: [48, 25],
      rHand: [71, 26],
      lFoot: [50, 45],
      rFoot: [69, 44],
      extra: `<path d="M34 28 H43 M38 25 L43 28 L38 31" stroke="${C_ACCENT}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>`
    },
    run: {
      head: [66, 12],
      neck: [63, 18],
      hip: [56, 31],
      lHand: [45, 22],
      rHand: [75, 21],
      lFoot: [44, 42],
      rFoot: [72, 44],
      extra: `<path d="M26 20 H38 M24 27 H34 M28 34 H36" stroke="${C_ACCENT}" stroke-width="1.3" stroke-linecap="round"/>`
    },
    jumpAir: {
      head: [60, 9],
      neck: [60, 15],
      hip: [60, 26],
      lHand: [46, 11],
      rHand: [74, 11],
      lFoot: [52, 36],
      rFoot: [68, 35],
      extra: `<path d="M60 44 V37 M56 40 L60 36 L64 40" stroke="${C_ACCENT}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>`
    },
    jumpLand: {
      head: [62, 18],
      neck: [60, 24],
      hip: [56, 36],
      lHand: [45, 31],
      rHand: [74, 30],
      lFoot: [50, 45],
      rFoot: [67, 45],
      extra: `<path d="M42 45 Q36 41 32 45 M78 45 Q84 41 88 45" stroke="${C_ACCENT}" stroke-width="1.3" stroke-linecap="round"/>`
    },
    wave: {
      head: [58, 12],
      neck: [58, 18],
      hip: [58, 31],
      lHand: [49, 29],
      rHand: [74, 11],
      lFoot: [53, 45],
      rFoot: [64, 45],
      extra: `<path d="M77 8 Q82 11 79 16 M81 6 Q87 11 83 18" stroke="${C_ACCENT}" stroke-width="1.2" stroke-linecap="round"/>`
    },
    handsOnHips: {
      head: [60, 11],
      neck: [60, 17],
      hip: [60, 31],
      lHand: [55, 29],
      rHand: [65, 29],
      lFoot: [53, 45],
      rFoot: [67, 45],
      extra: `<polyline points="60,18 47,24 55,29" stroke="${C_ACCENT}" stroke-width="1.6" stroke-linejoin="round"/><polyline points="60,18 73,24 65,29" stroke="${C_ACCENT}" stroke-width="1.6" stroke-linejoin="round"/>`
    },
    point: {
      head: [56, 12],
      neck: [56, 18],
      hip: [56, 31],
      lHand: [48, 29],
      rHand: [82, 18],
      lFoot: [51, 45],
      rFoot: [62, 45],
      extra: `<circle cx="88" cy="18" r="2.2" fill="${C_ACCENT}"/><path d="M88 12 V14 M88 22 V24 M92 18 H94" stroke="${C_ACCENT}" stroke-width="1.2" stroke-linecap="round"/>`
    },
    think: {
      head: [60, 13],
      neck: [60, 19],
      hip: [60, 32],
      lHand: [53, 27],
      rHand: [63, 15],
      lFoot: [55, 45],
      rFoot: [65, 45],
      extra: `<circle cx="73" cy="9" r="1.5" fill="${C_ACCENT}"/><circle cx="79" cy="6" r="2.5" stroke="${C_ACCENT}" stroke-width="1.2" fill="${C_ACCENT_SOFT}"/>`
    },
    crouch: {
      head: [62, 19],
      neck: [60, 25],
      hip: [54, 36],
      lHand: [70, 26],
      rHand: [74, 30],
      lFoot: [49, 45],
      rFoot: [66, 45]
    },
    kneel: {
      head: [60, 15],
      neck: [60, 21],
      hip: [58, 34],
      lHand: [66, 32],
      rHand: [52, 31],
      lFoot: [68, 45],
      rFoot: [48, 45],
      extra: `<polyline points="58,34 54,45 45,45" stroke="${C_STROKE}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
    },
    bow: {
      head: [73, 19],
      neck: [67, 22],
      hip: [54, 31],
      lHand: [64, 31],
      rHand: [67, 31],
      lFoot: [52, 45],
      rFoot: [58, 45],
      extra: `<path d="M62 10 Q72 11 76 17" stroke="${C_ACCENT}" stroke-width="1.2" stroke-dasharray="2 2" stroke-linecap="round"/>`
    },
    fightGuard: {
      head: [60, 12],
      neck: [59, 18],
      hip: [57, 31],
      lHand: [68, 16],
      rHand: [73, 20],
      lFoot: [48, 45],
      rFoot: [67, 45],
      extra: `<circle cx="68" cy="16" r="2" fill="${C_ACCENT}"/><circle cx="73" cy="20" r="2" fill="${C_ACCENT}"/>`
    },
    sit: {
      head: [58, 13],
      neck: [58, 19],
      hip: [58, 32],
      lHand: [66, 31],
      rHand: [64, 31],
      lFoot: [70, 45],
      rFoot: [73, 45],
      extra: `<path d="M48 24 V45 M48 35 H64 V45" stroke="${C_MUTED}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`
    },
    hitReact: {
      head: [52, 13],
      neck: [55, 19],
      hip: [60, 32],
      lHand: [46, 20],
      rHand: [68, 22],
      lFoot: [54, 45],
      rFoot: [68, 45],
      extra: `<path d="M74 16 L66 20 L73 24 M78 12 L70 18" stroke="${C_ACCENT}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`
    },
    death: {
      head: [82, 41],
      neck: [74, 42],
      hip: [56, 43],
      lHand: [78, 45],
      rHand: [68, 38],
      lFoot: [40, 45],
      rFoot: [45, 41],
      extra: `<path d="M58 18 Q68 24 72 35" stroke="${C_MUTED}" stroke-width="1.2" stroke-dasharray="2 2"/>`
    },
    celebrate: {
      head: [60, 11],
      neck: [60, 17],
      hip: [60, 30],
      lHand: [45, 8],
      rHand: [75, 8],
      lFoot: [51, 43],
      rFoot: [69, 43],
      extra: `<path d="M38 10 L41 12 M82 10 L79 12 M60 4 V6" stroke="${C_ACCENT}" stroke-width="1.4" stroke-linecap="round"/>`
    }
  }

  const s = P[pose] ?? P.idle
  const handsCustom = pose === 'handsOnHips'
  const arms = handsCustom
    ? ''
    : `<line x1="${s.neck[0]}" y1="${s.neck[1]}" x2="${s.lHand[0]}" y2="${s.lHand[1]}" stroke="${C_ACCENT}" stroke-width="1.7" stroke-linecap="round" />
       <line x1="${s.neck[0]}" y1="${s.neck[1]}" x2="${s.rHand[0]}" y2="${s.rHand[1]}" stroke="${C_ACCENT}" stroke-width="1.7" stroke-linecap="round" />`

  return `
    ${ground}
    <line x1="${s.neck[0]}" y1="${s.neck[1]}" x2="${s.hip[0]}" y2="${s.hip[1]}" stroke="${C_STROKE}" stroke-width="2" stroke-linecap="round" />
    ${arms}
    <line x1="${s.hip[0]}" y1="${s.hip[1]}" x2="${s.lFoot[0]}" y2="${s.lFoot[1]}" stroke="${C_STROKE}" stroke-width="1.8" stroke-linecap="round" />
    <line x1="${s.hip[0]}" y1="${s.hip[1]}" x2="${s.rFoot[0]}" y2="${s.rFoot[1]}" stroke="${C_STROKE}" stroke-width="1.8" stroke-linecap="round" />
    <circle cx="${s.head[0]}" cy="${s.head[1]}" r="4.2" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.6" />
    <circle cx="${s.hip[0]}" cy="${s.hip[1]}" r="2" fill="${C_STROKE}" />
    ${s.extra ?? ''}
    ${animBadge}
  `
}

/** 渲染景别示意图 */
function renderShotSizeSvg(size: PresetShotSize = 'medium', diagram?: string): string {
  if (diagram?.includes('shotConfrontation')) {
    return `
      ${viewfinderFrame(12, 5, 96, 42)}
      <line x1="16" y1="42" x2="104" y2="34" stroke="${C_MUTED}" stroke-width="1" />
      ${personSilhouette(34, 15, 0.9, true)}
      ${personSilhouette(86, 13, 0.95, false)}
      <line x1="46" y1="24" x2="74" y2="23" stroke="${C_ACCENT}" stroke-width="1.4" stroke-dasharray="3 2" />
    `
  }
  if (diagram?.includes('shotEstablish') || size === 'extremeWide' || size === 'wide') {
    const isVideo = diagram?.startsWith('video.')
    return `
      ${viewfinderFrame(12, 5, 96, 42)}
      <path d="M16 38 L38 18 L56 32 L76 14 L104 38 Z" fill="${C_FAINT}" stroke="${C_MUTED}" stroke-width="1.2" stroke-linejoin="round" />
      <circle cx="88" cy="14" r="4" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.2" />
      ${personSilhouette(48, 28, 0.45, true)}
      ${isVideo ? `<path d="M24 12 H44 M40 9 L45 12 L40 15" stroke="${C_ACCENT}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    `
  }
  if (diagram?.includes('shotDetail') || size === 'extremeClose') {
    const isVideo = diagram?.startsWith('video.')
    return `
      ${viewfinderFrame(12, 5, 96, 42)}
      <circle cx="60" cy="26" r="14" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.5" />
      <circle cx="60" cy="26" r="5" fill="${C_ACCENT}" />
      <line x1="38" y1="26" x2="44" y2="26" stroke="${C_MUTED}" stroke-width="1.2" />
      <line x1="76" y1="26" x2="82" y2="26" stroke="${C_MUTED}" stroke-width="1.2" />
      ${isVideo ? `<path d="M84 16 Q92 26 84 36" stroke="${C_ACCENT}" stroke-width="1.3" stroke-linecap="round"/>` : ''}
    `
  }

  const scaleMap: Record<PresetShotSize, number> = {
    extremeWide: 0.42,
    wide: 0.55,
    full: 0.72,
    medium: 0.9,
    mediumClose: 1.05,
    close: 1.25,
    extremeClose: 1.45
  }
  const sc = scaleMap[size] ?? 0.9
  const cy = Math.max(8, 26 - sc * 12)
  return `
    ${viewfinderFrame(16, 5, 88, 42)}
    ${personSilhouette(60, cy, sc, true)}
  `
}

/** 渲染运镜示意图 */
function renderCameraSvg(cam: PresetCameraMotion = 'dolly', diagram?: string): string {
  if (diagram === 'video.heroEntrance') {
    return `
      ${viewfinderFrame(14, 5, 92, 42)}
      <path d="M60 7 L34 45 M60 7 L86 45" stroke="${C_ACCENT_MID}" stroke-width="1" stroke-dasharray="2 2" />
      ${personSilhouette(60, 14, 0.95, true)}
      <path d="M28 40 V14 M24 18 L28 13 L32 18" stroke="${C_ACCENT}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    `
  }
  if (cam === 'orbit') {
    return `
      <ellipse cx="60" cy="28" rx="40" ry="14" stroke="${C_ACCENT}" stroke-width="1.5" stroke-dasharray="4 2" fill="${C_ACCENT_SOFT}" />
      ${personSilhouette(60, 13, 0.75, true)}
      <polyline points="88,16 95,20 87,23" stroke="${C_ACCENT}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      <polyline points="32,39 25,35 33,32" stroke="${C_ACCENT}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    `
  }
  if (cam === 'pan') {
    return `
      ${viewfinderFrame(22, 8, 76, 36)}
      ${personSilhouette(60, 15, 0.72, false)}
      <path d="M12 26 H108" stroke="${C_ACCENT}" stroke-width="1.6" stroke-linecap="round" />
      <polyline points="18,21 12,26 18,31" stroke="${C_ACCENT}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      <polyline points="102,21 108,26 102,31" stroke="${C_ACCENT}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M60 4 V48" stroke="${C_ACCENT_MID}" stroke-width="1.2" stroke-dasharray="2 2" />
    `
  }
  if (cam === 'crane' || cam === 'tilt') {
    return `
      ${viewfinderFrame(24, 6, 72, 40)}
      ${personSilhouette(66, 16, 0.75, false)}
      <path d="M38 42 V10" stroke="${C_ACCENT}" stroke-width="1.8" stroke-linecap="round" />
      <polyline points="33,15 38,9 43,15" stroke="${C_ACCENT}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      <polyline points="33,37 38,43 43,37" stroke="${C_ACCENT}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    `
  }
  if (cam === 'follow') {
    return `
      <rect x="16" y="18" width="18" height="14" rx="2" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
      <polygon points="34,21 42,17 42,33 34,29" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.2" />
      <path d="M46 25 H68 M63 21 L69 25 L63 29" stroke="${C_ACCENT}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      ${personSilhouette(86, 11, 0.85, true)}
      <path d="M98 25 H109 M105 21 L110 25 L105 29" stroke="${C_MUTED}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
    `
  }
  if (cam === 'combo') {
    return `
      ${personSilhouette(64, 14, 0.75, true)}
      <path d="M16 38 C32 38, 36 14, 58 14 C80 14, 84 36, 104 20" stroke="${C_ACCENT}" stroke-width="1.8" fill="none" stroke-linecap="round" />
      <polyline points="99,18 105,19 103,25" stroke="${C_ACCENT}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="16" cy="38" r="2.5" fill="${C_ACCENT}" />
      <circle cx="58" cy="14" r="2.2" fill="${C_ACCENT}" />
    `
  }
  if (cam === 'dutch') {
    return `
      <g transform="rotate(-14 60 26)">
        ${viewfinderFrame(22, 8, 76, 36)}
        ${personSilhouette(60, 14, 0.75, true)}
      </g>
    `
  }
  if (cam === 'handheld') {
    return `
      ${viewfinderFrame(24, 8, 72, 36)}
      ${personSilhouette(60, 14, 0.75, true)}
      <path d="M14 16 Q10 26 14 36 M106 16 Q110 26 106 36" stroke="${C_ACCENT}" stroke-width="1.4" stroke-linecap="round" />
    `
  }
  if (cam === 'static') {
    return `
      ${viewfinderFrame(20, 6, 80, 40)}
      ${personSilhouette(60, 14, 0.8, true)}
      <line x1="54" y1="26" x2="66" y2="26" stroke="${C_ACCENT}" stroke-width="1.2" />
      <line x1="60" y1="20" x2="60" y2="32" stroke="${C_ACCENT}" stroke-width="1.2" />
    `
  }
  return `
    <rect x="14" y="6" width="92" height="40" rx="3" stroke="${C_MUTED}" stroke-width="1.1" stroke-dasharray="3 2" />
    <rect x="32" y="13" width="56" height="26" rx="2" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
    ${personSilhouette(60, 15, 0.65, true)}
    <path d="M16 8 L32 14 M104 8 L88 14 M16 44 L32 38 M104 44 L88 38" stroke="${C_ACCENT}" stroke-width="1.3" stroke-linecap="round" />
  `
}

/** 渲染人物朝向示意图 */
function renderFacingSvg(facing: PresetFacing = 'front', diagram?: string): string {
  if (diagram === 'video.poseHandsOnHips') {
    return renderPoseSkeleton('handsOnHips', false)
  }
  if (facing === 'profile') {
    return `
      ${viewfinderFrame(20, 5, 80, 42)}
      <path d="M52 12 A7 7 0 1 1 52 26 L56 26 L53 22 L57 19 L52 16 Z" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.5" stroke-linejoin="round" />
      <path d="M45 43 C45 30 57 30 57 43 Z" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.5" />
      <path d="M62 19 H86 M81 15 L87 19 L81 23" stroke="${C_ACCENT}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    `
  }
  if (facing === 'threeQuarter') {
    return `
      ${viewfinderFrame(20, 5, 80, 42)}
      <circle cx="54" cy="18" r="6.5" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.5" />
      <path d="M56 12 Q60 18 56 24" stroke="${C_ACCENT}" stroke-width="1.2" />
      <path d="M42 43 C43 28 67 29 66 43 Z" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.5" />
      <path d="M64 17 L82 12 M77 10 L83 12 L79 16" stroke="${C_ACCENT}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
    `
  }
  if (facing === 'backThreeQuarter') {
    return `
      ${viewfinderFrame(20, 5, 80, 42)}
      <path d="M44 43 C44 28 68 28 68 43 Z" fill="${C_FAINT}" stroke="${C_STROKE}" stroke-width="1.5" />
      <circle cx="56" cy="18" r="6.5" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.5" />
      <path d="M64 22 C76 22 76 13 65 13" stroke="${C_ACCENT}" stroke-width="1.4" stroke-linecap="round" />
      <polyline points="68,10 64,13 68,16" stroke="${C_ACCENT}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
    `
  }
  if (facing === 'back') {
    return `
      ${viewfinderFrame(20, 5, 80, 42)}
      <circle cx="60" cy="18" r="6.5" fill="${C_FAINT}" stroke="${C_STROKE}" stroke-width="1.5" />
      <path d="M46 43 C46 28 74 28 74 43 Z" fill="${C_FAINT}" stroke="${C_STROKE}" stroke-width="1.5" />
      <line x1="60" y1="26" x2="60" y2="41" stroke="${C_MUTED}" stroke-width="1.2" stroke-dasharray="2 2" />
    `
  }
  return `
    ${viewfinderFrame(20, 5, 80, 42)}
    <circle cx="60" cy="17" r="6.5" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.5" />
    <circle cx="58" cy="16" r="1" fill="${C_ACCENT}" />
    <circle cx="62" cy="16" r="1" fill="${C_ACCENT}" />
    <path d="M46 43 C46 28 74 28 74 43 Z" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.5" />
  `
}

/** 渲染布光示意图 */
function renderLightingSvg(lighting: PresetLighting = 'volumetric'): string {
  const beamPath =
    lighting === 'top'
      ? `<polygon points="48,4 72,4 82,44 38,44" fill="${C_ACCENT_SOFT}" />`
      : lighting === 'backlight'
        ? `<circle cx="60" cy="24" r="16" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" stroke-dasharray="3 2" />`
        : `<polygon points="14,6 34,6 86,44 40,46" fill="${C_ACCENT_SOFT}" />`
  return `
    ${viewfinderFrame(14, 5, 92, 42)}
    ${beamPath}
    <circle cx="22" cy="11" r="4" fill="${C_ACCENT}" />
    ${personSilhouette(64, 15, 0.82, true)}
  `
}

/** 渲染表情/表演示意图 */
function renderMoodSvg(mood: PresetMood = 'confidence', diagram?: string): string {
  if (diagram === 'video.performanceRealism') {
    return `
      <circle cx="32" cy="26" r="13" fill="${C_FAINT}" stroke="${C_MUTED}" stroke-width="1.4" />
      <path d="M27 22 L31 24 M37 22 L33 24 M28 31 H36" stroke="${C_STROKE}" stroke-width="1.4" stroke-linecap="round" />
      <path d="M49 26 H67 M63 22 L68 26 L63 30" stroke="${C_ACCENT}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="86" cy="26" r="13" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.5" />
      <path d="M81 21 Q83 19 85 21 M87 21 Q89 19 91 21 M81 30 Q86 35 91 30" stroke="${C_ACCENT}" stroke-width="1.5" stroke-linecap="round" />
    `
  }
  const mouth =
    mood === 'anger' || mood === 'grief' || mood === 'anxiety'
      ? `<path d="M52 34 Q60 28 68 34" stroke="${C_ACCENT}" stroke-width="1.8" stroke-linecap="round" />`
      : mood === 'surprise'
        ? `<circle cx="60" cy="33" r="3.5" stroke="${C_ACCENT}" stroke-width="1.6" />`
        : `<path d="M52 30 Q60 37 68 30" stroke="${C_ACCENT}" stroke-width="1.8" stroke-linecap="round" />`
  return `
    <circle cx="60" cy="26" r="17" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.6" />
    <circle cx="54" cy="22" r="1.6" fill="${C_STROKE}" />
    <circle cx="66" cy="22" r="1.6" fill="${C_STROKE}" />
    ${mouth}
  `
}

/** 渲染宫格类与设定图类示意图 */
function renderGridSvg(cols = 3, rows = 3, diagram?: string): string {
  if (diagram === 'image.characterSheet') {
    return `
      <rect x="14" y="6" width="38" height="40" rx="3" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
      ${personSilhouette(33, 12, 0.85, true)}
      <rect x="56" y="6" width="23" height="18" rx="2" fill="${C_FAINT}" stroke="${C_MUTED}" stroke-width="1.2" />
      <circle cx="67.5" cy="15" r="5" stroke="${C_ACCENT}" stroke-width="1.2" />
      <rect x="83" y="6" width="23" height="18" rx="2" fill="${C_FAINT}" stroke="${C_MUTED}" stroke-width="1.2" />
      <circle cx="94.5" cy="15" r="5" stroke="${C_STROKE}" stroke-width="1.2" />
      <rect x="56" y="28" width="50" height="18" rx="2" fill="${C_FAINT}" stroke="${C_MUTED}" stroke-width="1.2" />
      <line x1="62" y1="34" x2="98" y2="34" stroke="${C_ACCENT}" stroke-width="1.4" stroke-linecap="round" />
      <line x1="62" y1="40" x2="88" y2="40" stroke="${C_MUTED}" stroke-width="1.4" stroke-linecap="round" />
    `
  }
  if (diagram === 'image.sceneSheet') {
    return `
      <rect x="14" y="6" width="60" height="40" rx="3" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
      <path d="M14 36 L34 22 L52 32 L64 24 L74 36" stroke="${C_ACCENT}" stroke-width="1.3" fill="none" />
      <line x1="14" y1="36" x2="74" y2="36" stroke="${C_MUTED}" stroke-width="1" />
      <rect x="78" y="6" width="28" height="18" rx="2" fill="${C_FAINT}" stroke="${C_MUTED}" stroke-width="1.2" />
      <rect x="78" y="28" width="28" height="18" rx="2" fill="${C_FAINT}" stroke="${C_MUTED}" stroke-width="1.2" />
    `
  }
  if (diagram === 'image.productSheet') {
    return `
      <rect x="14" y="6" width="54" height="40" rx="3" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
      <polygon points="41,13 57,21 57,35 41,42 25,35 25,21" fill="${C_FAINT}" stroke="${C_ACCENT}" stroke-width="1.4" stroke-linejoin="round" />
      <polyline points="25,21 41,28 57,21" stroke="${C_ACCENT}" stroke-width="1.2" />
      <line x1="41" y1="28" x2="41" y2="42" stroke="${C_ACCENT}" stroke-width="1.2" />
      <rect x="72" y="6" width="34" height="18" rx="2" fill="${C_FAINT}" stroke="${C_MUTED}" stroke-width="1.2" />
      <rect x="72" y="28" width="34" height="18" rx="2" fill="${C_FAINT}" stroke="${C_MUTED}" stroke-width="1.2" />
    `
  }
  if (diagram === 'image.story4' || (cols === 2 && rows === 2 && !diagram)) {
    return `
      <rect x="16" y="6" width="41" height="18" rx="2.5" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.3" />
      <rect x="63" y="6" width="41" height="18" rx="2.5" fill="${C_FAINT}" stroke="${C_MUTED}" stroke-width="1.2" />
      <rect x="16" y="28" width="41" height="18" rx="2.5" fill="${C_FAINT}" stroke="${C_MUTED}" stroke-width="1.2" />
      <rect x="63" y="28" width="41" height="18" rx="2.5" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.3" />
      <path d="M44 15 H72 L44 37 H76" stroke="${C_ACCENT}" stroke-width="1.4" stroke-dasharray="2 2" stroke-linecap="round" stroke-linejoin="round" />
    `
  }

  const x0 = 16
  const y0 = 6
  const totalW = 88
  const totalH = 40
  const gap = cols >= 5 ? 2 : 3
  const cw = (totalW - gap * (cols - 1)) / cols
  const ch = (totalH - gap * (rows - 1)) / rows
  const rects: string[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rx = x0 + c * (cw + gap)
      const ry = y0 + r * (ch + gap)
      const isHighlight = (r + c) % 2 === 0
      rects.push(
        `<rect x="${rx.toFixed(1)}" y="${ry.toFixed(1)}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" rx="1.5" fill="${isHighlight ? C_ACCENT_SOFT : C_FAINT}" stroke="${isHighlight ? C_ACCENT : C_MUTED}" stroke-width="1" />`
      )
    }
  }
  return rects.join('')
}

/** 根据具体 preset id / diagram 键绘制专属示意图 */
export function buildPresetSchematicSvg(input: {
  visual: PresetVisual
  presetId?: string | null
  presetKind?: string | null
}): string {
  const rawId = input.presetId || input.visual.diagram || ''
  const kind = input.presetKind || ''
  const fullKey = kind && rawId && !rawId.startsWith(`${kind}.`) ? `${kind}.${rawId}` : rawId

  // 1. 图片生成专属预设
  if (rawId === 'image.styleTransfer') {
    return wrapSvg(
      `
      <rect x="12" y="10" width="30" height="32" rx="3" fill="${C_FAINT}" stroke="${C_STROKE}" stroke-width="1.3" />
      ${personSilhouette(27, 16, 0.65, false)}
      <circle cx="58" cy="26" r="10" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
      <circle cx="55" cy="23" r="1.8" fill="${C_ACCENT}" />
      <circle cx="61" cy="22" r="1.8" fill="${C_STROKE}" />
      <circle cx="60" cy="29" r="1.8" fill="${C_ACCENT}" />
      <path d="M71 26 H77 M74 23 L78 26 L74 29" stroke="${C_ACCENT}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
      <rect x="80" y="10" width="30" height="32" rx="3" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.5" />
      ${personSilhouette(95, 16, 0.65, true)}
      `,
      fullKey
    )
  }
  if (rawId === 'image.faceTurnaround') {
    return wrapSvg(
      `
      <line x1="14" y1="18" x2="106" y2="18" stroke="${C_MUTED}" stroke-width="0.9" stroke-dasharray="2 2" />
      <line x1="14" y1="34" x2="106" y2="34" stroke="${C_MUTED}" stroke-width="0.9" stroke-dasharray="2 2" />
      <circle cx="30" cy="26" r="10" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
      <line x1="30" y1="16" x2="30" y2="36" stroke="${C_ACCENT}" stroke-width="1.1" />
      <circle cx="60" cy="26" r="10" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
      <path d="M62 16 Q67 26 62 36" stroke="${C_ACCENT}" stroke-width="1.2" />
      <path d="M86 16 A10 10 0 1 1 86 36 L92 36 L89 29 L94 26 L88 22 Z" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" stroke-linejoin="round" />
      `,
      fullKey
    )
  }
  if (rawId === 'image.characterTurnaround') {
    return wrapSvg(
      `
      <line x1="14" y1="12" x2="106" y2="12" stroke="${C_MUTED}" stroke-width="0.9" stroke-dasharray="2 2" />
      <line x1="14" y1="44" x2="106" y2="44" stroke="${C_MUTED}" stroke-width="1" />
      ${personSilhouette(30, 12, 0.85, true)}
      <circle cx="60" cy="16" r="3.8" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
      <rect x="56" y="21" width="8" height="22" rx="3" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
      ${personSilhouette(90, 12, 0.85, false)}
      `,
      fullKey
    )
  }
  if (rawId === 'image.propTurnaround') {
    return wrapSvg(
      `
      <rect x="16" y="16" width="22" height="22" rx="2" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
      <line x1="16" y1="25" x2="38" y2="25" stroke="${C_ACCENT}" stroke-width="1.2" />
      <rect x="50" y="16" width="16" height="22" rx="2" fill="${C_FAINT}" stroke="${C_STROKE}" stroke-width="1.3" />
      <line x1="50" y1="25" x2="66" y2="25" stroke="${C_STROKE}" stroke-width="1.2" />
      <rect x="78" y="16" width="24" height="22" rx="2" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
      <circle cx="90" cy="27" r="4" stroke="${C_ACCENT}" stroke-width="1.2" />
      `,
      fullKey
    )
  }
  if (rawId === 'image.weaponTurnaround') {
    return wrapSvg(
      `
      <line x1="30" y1="8" x2="30" y2="44" stroke="${C_ACCENT}" stroke-width="2.2" stroke-linecap="round" />
      <line x1="22" y1="34" x2="38" y2="34" stroke="${C_STROKE}" stroke-width="2" stroke-linecap="round" />
      <line x1="60" y1="8" x2="60" y2="44" stroke="${C_STROKE}" stroke-width="1.4" stroke-linecap="round" />
      <line x1="56" y1="34" x2="64" y2="34" stroke="${C_STROKE}" stroke-width="1.8" stroke-linecap="round" />
      <rect x="78" y="12" width="26" height="28" rx="3" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.3" />
      <polygon points="91,17 98,26 91,35 84,26" fill="${C_FAINT}" stroke="${C_ACCENT}" stroke-width="1.2" />
      `,
      fullKey
    )
  }
  if (rawId === 'image.physics3sLater') {
    return wrapSvg(
      `
      <g opacity="0.45">${personSilhouette(28, 16, 0.78, false)}</g>
      <path d="M40 24 Q60 10 78 24" stroke="${C_ACCENT}" stroke-width="1.6" stroke-dasharray="3 2" fill="none" />
      <polyline points="73,20 79,24 73,27" stroke="${C_ACCENT}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      ${personSilhouette(92, 16, 0.78, true)}
      `,
      fullKey
    )
  }
  if (rawId === 'image.physics5sBefore') {
    return wrapSvg(
      `
      ${personSilhouette(28, 16, 0.78, true)}
      <path d="M80 24 Q60 10 42 24" stroke="${C_ACCENT}" stroke-width="1.6" stroke-dasharray="3 2" fill="none" />
      <polyline points="47,20 41,24 47,27" stroke="${C_ACCENT}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      <g opacity="0.45">${personSilhouette(92, 16, 0.78, false)}</g>
      `,
      fullKey
    )
  }
  if (rawId === 'image.panorama720') {
    return wrapSvg(
      `
      <ellipse cx="60" cy="26" rx="44" ry="18" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.5" />
      <ellipse cx="60" cy="26" rx="22" ry="18" stroke="${C_MUTED}" stroke-width="1.1" stroke-dasharray="3 2" />
      <line x1="16" y1="26" x2="104" y2="26" stroke="${C_ACCENT}" stroke-width="1.2" />
      <path d="M24 18 Q60 24 96 18 M24 34 Q60 28 96 34" stroke="${C_MUTED}" stroke-width="1" />
      `,
      fullKey
    )
  }

  // 2. 视频生成专属预设
  if (rawId === 'video.firstLastFrame' || rawId === 'video.framePairContinuity') {
    const hasMid = rawId === 'video.framePairContinuity'
    return wrapSvg(
      `
      <rect x="12" y="10" width="28" height="32" rx="3" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
      ${personSilhouette(26, 16, 0.6, true)}
      ${hasMid ? `<g opacity="0.45">${personSilhouette(60, 14, 0.55, false)}</g>` : ''}
      <path d="M44 26 C54 14, 66 14, 76 26" stroke="${C_ACCENT}" stroke-width="1.6" stroke-dasharray="3 2" fill="none" />
      <polyline points="72,22 77,26 71,28" stroke="${C_ACCENT}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      <rect x="80" y="10" width="28" height="32" rx="3" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
      ${personSilhouette(94, 16, 0.6, true)}
      `,
      fullKey
    )
  }
  if (rawId === 'video.framePairProduct') {
    return wrapSvg(
      `
      <rect x="12" y="10" width="30" height="32" rx="3" fill="${C_FAINT}" stroke="${C_MUTED}" stroke-width="1.3" />
      <circle cx="27" cy="26" r="9" stroke="${C_ACCENT}" stroke-width="1.4" fill="${C_ACCENT_SOFT}" />
      <path d="M46 26 H72 M67 22 L73 26 L67 30" stroke="${C_ACCENT}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      <rect x="76" y="8" width="32" height="36" rx="3" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.5" />
      <polygon points="92,15 101,20 101,31 92,36 83,31 83,20" stroke="${C_ACCENT}" stroke-width="1.3" fill="${C_FAINT}" />
      `,
      fullKey
    )
  }
  if (rawId === 'video.framePairTransition') {
    return wrapSvg(
      `
      <rect x="14" y="10" width="36" height="32" rx="3" fill="${C_FAINT}" stroke="${C_STROKE}" stroke-width="1.3" />
      <circle cx="32" cy="26" r="8" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
      <path d="M44 26 H76" stroke="${C_ACCENT}" stroke-width="1.5" stroke-dasharray="2 2" />
      <rect x="70" y="10" width="36" height="32" rx="3" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
      <circle cx="88" cy="26" r="8" fill="${C_ACCENT}" opacity="0.7" />
      `,
      fullKey
    )
  }
  if (rawId === 'video.transitionDissolve') {
    return wrapSvg(
      `
      <rect x="18" y="8" width="52" height="34" rx="3" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
      <rect x="50" y="10" width="52" height="34" rx="3" fill="${C_ACCENT_SOFT}" stroke="${C_STROKE}" stroke-width="1.4" stroke-dasharray="3 2" />
      <circle cx="60" cy="26" r="8" fill="${C_ACCENT_MID}" stroke="${C_ACCENT}" stroke-width="1.4" />
      `,
      fullKey
    )
  }
  if (rawId === 'video.transitionHard') {
    return wrapSvg(
      `
      <rect x="14" y="10" width="40" height="32" rx="3" fill="${C_FAINT}" stroke="${C_STROKE}" stroke-width="1.3" />
      <rect x="66" y="10" width="40" height="32" rx="3" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
      <polyline points="63,5 56,24 64,26 57,47" stroke="${C_ACCENT}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      `,
      fullKey
    )
  }
  if (rawId === 'video.transitionFlash') {
    return wrapSvg(
      `
      <rect x="14" y="10" width="36" height="32" rx="3" fill="${C_FAINT}" stroke="${C_MUTED}" stroke-width="1.2" />
      <rect x="70" y="10" width="36" height="32" rx="3" fill="${C_FAINT}" stroke="${C_MUTED}" stroke-width="1.2" />
      <polygon points="60,6 64,20 78,26 64,32 60,46 56,32 42,26 56,20" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.5" stroke-linejoin="round" />
      `,
      fullKey
    )
  }
  if (rawId === 'video.transitionMotion') {
    return wrapSvg(
      `
      <rect x="12" y="10" width="32" height="32" rx="3" fill="${C_FAINT}" stroke="${C_MUTED}" stroke-width="1.2" />
      <rect x="76" y="10" width="32" height="32" rx="3" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
      <path d="M36 18 H82 M32 26 H86 M38 34 H80" stroke="${C_ACCENT}" stroke-width="1.8" stroke-linecap="round" />
      `,
      fullKey
    )
  }
  if (rawId === 'video.transitionOcclusion') {
    return wrapSvg(
      `
      <rect x="14" y="10" width="38" height="32" rx="3" fill="${C_FAINT}" stroke="${C_MUTED}" stroke-width="1.2" />
      <rect x="68" y="10" width="38" height="32" rx="3" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.3" />
      <polygon points="48,6 68,6 62,46 42,46" fill="${C_STROKE}" opacity="0.7" />
      `,
      fullKey
    )
  }
  if (rawId === 'video.transitionFocus') {
    return wrapSvg(
      `
      <circle cx="28" cy="22" r="9" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.2" stroke-dasharray="2 2" />
      <circle cx="38" cy="30" r="7" fill="${C_FAINT}" stroke="${C_MUTED}" stroke-width="1.2" stroke-dasharray="2 2" />
      <path d="M52 26 H68 M64 22 L69 26 L64 30" stroke="${C_ACCENT}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      <rect x="74" y="10" width="32" height="32" rx="3" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.5" />
      ${personSilhouette(90, 15, 0.65, true)}
      `,
      fullKey
    )
  }
  if (rawId === 'video.textToVideo') {
    return wrapSvg(
      `
      <rect x="12" y="11" width="34" height="30" rx="3" fill="${C_FAINT}" stroke="${C_MUTED}" stroke-width="1.3" />
      <line x1="18" y1="19" x2="40" y2="19" stroke="${C_STROKE}" stroke-width="1.5" stroke-linecap="round" />
      <line x1="18" y1="26" x2="38" y2="26" stroke="${C_ACCENT}" stroke-width="1.5" stroke-linecap="round" />
      <line x1="18" y1="33" x2="33" y2="33" stroke="${C_MUTED}" stroke-width="1.5" stroke-linecap="round" />
      <path d="M50 26 H66 M62 22 L67 26 L62 30" stroke="${C_ACCENT}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      <rect x="72" y="10" width="36" height="32" rx="3" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.5" />
      <polygon points="86,19 98,26 86,33" fill="${C_ACCENT}" />
      `,
      fullKey
    )
  }
  if (rawId === 'video.multimodalRef') {
    return wrapSvg(
      `
      <rect x="12" y="7" width="22" height="12" rx="2" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.2" />
      <rect x="12" y="21" width="22" height="12" rx="2" fill="${C_FAINT}" stroke="${C_STROKE}" stroke-width="1.2" />
      <rect x="12" y="35" width="22" height="12" rx="2" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.2" />
      <path d="M36 13 L64 24 M36 27 L64 26 M36 41 L64 28" stroke="${C_ACCENT}" stroke-width="1.3" stroke-linecap="round" />
      <rect x="68" y="10" width="38" height="32" rx="3" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.5" />
      <polygon points="83,19 95,26 83,33" fill="${C_ACCENT}" />
      `,
      fullKey
    )
  }
  if (rawId === 'video.poseWalk') return wrapSvg(renderPoseSkeleton('walk', false), fullKey)
  if (rawId === 'video.poseRun') return wrapSvg(renderPoseSkeleton('run', false), fullKey)
  if (rawId === 'video.poseSit') return wrapSvg(renderPoseSkeleton('sit', false), fullKey)
  if (rawId === 'video.poseHandsOnHips')
    return wrapSvg(renderPoseSkeleton('handsOnHips', false), fullKey)

  // 3. 对口型 (lipSync) 与 片段重拍 (reshoot)
  if (rawId.startsWith('lipSync.')) {
    const isVideo = rawId === 'lipSync.fromVideo'
    const isPerf = rawId === 'lipSync.performance'
    return wrapSvg(
      `
      <rect x="14" y="8" width="38" height="36" rx="4" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
      ${personSilhouette(33, isPerf ? 12 : 14, isPerf ? 0.78 : 0.7, true)}
      ${isVideo ? `<line x1="18" y1="12" x2="48" y2="12" stroke="${C_MUTED}" stroke-width="1.2" stroke-dasharray="2 2"/>` : ''}
      <path d="M58 26 L62 18 L66 34 L70 14 L74 38 L78 20 L82 32 L86 16 L90 35 L94 22 L98 29 L102 26" stroke="${C_ACCENT}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none" />
      `,
      fullKey
    )
  }
  if (rawId.startsWith('reshoot.')) {
    const mode = rawId.slice('reshoot.'.length)
    const badge =
      mode === 'prop'
        ? `<rect x="49" y="10" width="22" height="16" rx="2" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />`
        : mode === 'scene'
          ? `<path d="M44 26 L54 12 L64 22 L72 15 L78 26 Z" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.3" />`
          : mode === 'camera'
            ? `<rect x="46" y="12" width="18" height="12" rx="2" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" /><polygon points="64,15 72,11 72,25 64,21" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.2" />`
            : personSilhouette(60, 6, 0.65, true)
    return wrapSvg(
      `
      <line x1="14" y1="38" x2="106" y2="38" stroke="${C_MUTED}" stroke-width="2" stroke-linecap="round" />
      <rect x="40" y="33" width="40" height="10" rx="2" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.5" />
      ${badge}
      `,
      fullKey
    )
  }

  // 4. 剧本 / 世界元素提取 / 拆场
  if (rawId.startsWith('screenplay.')) {
    if (rawId === 'screenplay.twists') {
      return wrapSvg(
        `
        <polyline points="14,38 38,32 50,12 68,38 84,10 106,18" stroke="${C_ACCENT}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
        <circle cx="50" cy="12" r="3" fill="${C_ACCENT}" />
        <circle cx="84" cy="10" r="3" fill="${C_ACCENT}" />
        `,
        fullKey
      )
    }
    if (rawId === 'screenplay.dialogue') {
      return wrapSvg(
        `
        <rect x="14" y="8" width="48" height="20" rx="5" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
        <line x1="22" y1="15" x2="52" y2="15" stroke="${C_ACCENT}" stroke-width="1.4" stroke-linecap="round" />
        <line x1="22" y1="21" x2="42" y2="21" stroke="${C_MUTED}" stroke-width="1.4" stroke-linecap="round" />
        <rect x="58" y="24" width="48" height="20" rx="5" fill="${C_FAINT}" stroke="${C_STROKE}" stroke-width="1.4" />
        <line x1="66" y1="31" x2="96" y2="31" stroke="${C_STROKE}" stroke-width="1.4" stroke-linecap="round" />
        <line x1="66" y1="37" x2="88" y2="37" stroke="${C_MUTED}" stroke-width="1.4" stroke-linecap="round" />
        `,
        fullKey
      )
    }
    if (rawId === 'screenplay.hooks') {
      return wrapSvg(
        `
        <line x1="14" y1="26" x2="78" y2="26" stroke="${C_STROKE}" stroke-width="2" stroke-linecap="round" />
        <circle cx="30" cy="26" r="3" fill="${C_MUTED}" />
        <circle cx="54" cy="26" r="3" fill="${C_MUTED}" />
        <path d="M78 26 H88 C98 26 98 12 88 12 C82 12 82 20 88 20" stroke="${C_ACCENT}" stroke-width="2" stroke-linecap="round" fill="none" />
        <circle cx="102" cy="26" r="2.2" fill="${C_ACCENT}" />
        `,
        fullKey
      )
    }
    return wrapSvg(
      `
      <rect x="16" y="7" width="32" height="38" rx="3" fill="${C_FAINT}" stroke="${C_STROKE}" stroke-width="1.3" />
      <line x1="22" y1="15" x2="42" y2="15" stroke="${C_ACCENT}" stroke-width="1.5" stroke-linecap="round" />
      <line x1="22" y1="22" x2="42" y2="22" stroke="${C_MUTED}" stroke-width="1.3" stroke-linecap="round" />
      <line x1="22" y1="29" x2="36" y2="29" stroke="${C_MUTED}" stroke-width="1.3" stroke-linecap="round" />
      <rect x="58" y="8" width="46" height="10" rx="2" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.3" />
      <rect x="58" y="21" width="46" height="10" rx="2" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.3" />
      <rect x="58" y="34" width="46" height="10" rx="2" fill="${C_FAINT}" stroke="${C_MUTED}" stroke-width="1.2" />
      `,
      fullKey
    )
  }
  if (rawId.startsWith('spatialWorldExtract.')) {
    const isRefine = rawId.endsWith('.refine')
    return wrapSvg(
      `
      <rect x="12" y="10" width="26" height="32" rx="3" fill="${C_FAINT}" stroke="${C_STROKE}" stroke-width="1.3" />
      <path d="M42 26 H54 M50 22 L55 26 L50 30" stroke="${C_ACCENT}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
      <rect x="60" y="7" width="22" height="16" rx="2" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.3" />
      <rect x="86" y="7" width="22" height="16" rx="2" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.3" />
      <rect x="60" y="27" width="22" height="16" rx="2" fill="${C_FAINT}" stroke="${C_MUTED}" stroke-width="1.2" />
      <rect x="86" y="27" width="22" height="16" rx="2" fill="${C_FAINT}" stroke="${C_MUTED}" stroke-width="1.2" />
      ${isRefine ? `<polyline points="92,15 96,19 103,11" stroke="${C_ACCENT}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
      `,
      fullKey
    )
  }
  if (rawId.startsWith('beatSplit.')) {
    const isRefine = rawId.endsWith('.refine')
    return wrapSvg(
      `
      <rect x="14" y="12" width="26" height="28" rx="3" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
      <rect x="47" y="12" width="26" height="28" rx="3" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
      <rect x="80" y="12" width="26" height="28" rx="3" fill="${C_FAINT}" stroke="${C_STROKE}" stroke-width="1.3" />
      <path d="M40 26 H47 M73 26 H80" stroke="${C_ACCENT}" stroke-width="1.6" />
      ${isRefine ? `<polyline points="88,26 92,30 99,21" stroke="${C_ACCENT}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
      `,
      fullKey
    )
  }

  // 5. 游戏系统策划案 (gameSystem.*)
  if (rawId.startsWith('gameSystem.')) {
    if (rawId === 'gameSystem.inventory') {
      return wrapSvg(
        `
        ${renderGridSvg(3, 3, 'inventory')}
        `,
        fullKey
      )
    }
    if (rawId === 'gameSystem.mainUi') {
      return wrapSvg(
        `
        <rect x="14" y="6" width="92" height="40" rx="3" fill="${C_FAINT}" stroke="${C_STROKE}" stroke-width="1.3" />
        <rect x="18" y="10" width="32" height="7" rx="2" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.2" />
        <circle cx="96" cy="14" r="5" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.2" />
        <rect x="28" y="35" width="64" height="7" rx="2" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.2" />
        `,
        fullKey
      )
    }
    if (rawId === 'gameSystem.levelUp') {
      return wrapSvg(
        `
        <path d="M28 40 V12 M21 19 L28 11 L35 19" stroke="${C_ACCENT}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
        <rect x="48" y="12" width="54" height="7" rx="2" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.2" />
        <rect x="48" y="23" width="42" height="7" rx="2" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.2" />
        <rect x="48" y="34" width="30" height="7" rx="2" fill="${C_FAINT}" stroke="${C_MUTED}" stroke-width="1.2" />
        `,
        fullKey
      )
    }
    if (rawId === 'gameSystem.shop') {
      return wrapSvg(
        `
        <rect x="14" y="9" width="28" height="34" rx="3" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
        <polygon points="28,15 34,23 28,31 22,23" fill="${C_ACCENT}" />
        <rect x="46" y="9" width="28" height="34" rx="3" fill="${C_FAINT}" stroke="${C_STROKE}" stroke-width="1.3" />
        <polygon points="60,15 66,23 60,31 54,23" stroke="${C_ACCENT}" stroke-width="1.3" />
        <rect x="78" y="9" width="28" height="34" rx="3" fill="${C_FAINT}" stroke="${C_MUTED}" stroke-width="1.2" />
        `,
        fullKey
      )
    }
    if (rawId === 'gameSystem.recharge') {
      return wrapSvg(
        `
        <polygon points="34,10 48,22 34,42 20,22" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.5" stroke-linejoin="round" />
        <path d="M54 26 H70 M66 22 L71 26 L66 30" stroke="${C_ACCENT}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        <rect x="76" y="12" width="30" height="28" rx="4" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
        <polyline points="85,26 90,31 99,21" stroke="${C_ACCENT}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        `,
        fullKey
      )
    }
    if (rawId === 'gameSystem.align') {
      return wrapSvg(
        `
        <rect x="16" y="8" width="32" height="36" rx="3" fill="${C_FAINT}" stroke="${C_STROKE}" stroke-width="1.3" />
        <rect x="72" y="8" width="32" height="36" rx="3" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
        <path d="M52 20 H68 M52 32 H68" stroke="${C_ACCENT}" stroke-width="1.5" stroke-linecap="round" />
        <polyline points="82,26 87,31 95,21" stroke="${C_ACCENT}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        `,
        fullKey
      )
    }
    if (rawId === 'gameSystem.custom') {
      return wrapSvg(
        `
        <rect x="18" y="8" width="38" height="16" rx="2.5" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
        <rect x="64" y="8" width="38" height="16" rx="2.5" fill="${C_FAINT}" stroke="${C_MUTED}" stroke-width="1.2" stroke-dasharray="3 2" />
        <rect x="18" y="28" width="84" height="16" rx="2.5" fill="${C_FAINT}" stroke="${C_STROKE}" stroke-width="1.3" />
        <circle cx="83" cy="16" r="4" stroke="${C_ACCENT}" stroke-width="1.4" />
        `,
        fullKey
      )
    }
    return wrapSvg(
      `
      <rect x="44" y="6" width="32" height="12" rx="2.5" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
      <path d="M60 18 V26 M30 26 H90 M30 26 V32 M60 26 V32 M90 26 V32" stroke="${C_ACCENT}" stroke-width="1.3" />
      <rect x="16" y="32" width="28" height="13" rx="2" fill="${C_FAINT}" stroke="${C_STROKE}" stroke-width="1.2" />
      <rect x="46" y="32" width="28" height="13" rx="2" fill="${C_FAINT}" stroke="${C_STROKE}" stroke-width="1.2" />
      <rect x="76" y="32" width="28" height="13" rx="2" fill="${C_FAINT}" stroke="${C_STROKE}" stroke-width="1.2" />
      `,
      fullKey
    )
  }

  // 6. 声音 / 对话 / 音效 / 音乐
  if (rawId.startsWith('voice.')) {
    const wave =
      rawId === 'voice.adRead'
        ? `<path d="M46 26 L50 10 L55 42 L60 8 L65 44 L70 12 L75 38 L80 14 L85 36 L92 26" stroke="${C_ACCENT}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none" />`
        : rawId === 'voice.emotionSoft'
          ? `<path d="M46 26 Q58 14 70 26 T94 26" stroke="${C_ACCENT}" stroke-width="1.7" fill="none" stroke-linecap="round" />`
          : rawId === 'voice.tutorial'
            ? `<rect x="48" y="12" width="48" height="6" rx="2" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.2"/><rect x="48" y="23" width="38" height="6" rx="2" fill="${C_FAINT}" stroke="${C_STROKE}" stroke-width="1.2"/><rect x="48" y="34" width="28" height="6" rx="2" fill="${C_FAINT}" stroke="${C_MUTED}" stroke-width="1.2"/>`
            : `<path d="M46 26 L52 16 L58 36 L64 12 L70 40 L76 18 L82 34 L88 20 L94 30 L100 26" stroke="${C_ACCENT}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none" />`
    return wrapSvg(
      `
      <rect x="20" y="12" width="12" height="20" rx="6" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.5" />
      <path d="M16 24 A10 10 0 0 0 36 24 M26 34 V42 M20 42 H32" stroke="${C_ACCENT}" stroke-width="1.5" stroke-linecap="round" />
      ${wave}
      `,
      fullKey
    )
  }
  if (rawId.startsWith('dialogue.')) {
    const isConflict = rawId === 'dialogue.conflict'
    const isNpc = rawId === 'dialogue.gameNpc'
    const isInterview = rawId === 'dialogue.interview'
    return wrapSvg(
      `
      ${personSilhouette(24, 14, 0.72, true)}
      ${personSilhouette(96, 14, 0.72, false)}
      ${
        isConflict
          ? `<polyline points="62,10 55,25 65,27 57,42" stroke="${C_ACCENT}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
          : isNpc
            ? `<line x1="24" y1="5" x2="24" y2="10" stroke="${C_ACCENT}" stroke-width="2.2" stroke-linecap="round"/><rect x="42" y="14" width="36" height="22" rx="3" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.3"/>`
            : isInterview
              ? `<line x1="60" y1="18" x2="60" y2="42" stroke="${C_ACCENT}" stroke-width="1.8"/><circle cx="60" cy="15" r="4" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4"/>`
              : `<rect x="40" y="10" width="26" height="12" rx="4" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.3"/><rect x="54" y="28" width="26" height="12" rx="4" fill="${C_FAINT}" stroke="${C_STROKE}" stroke-width="1.3"/>`
      }
      `,
      fullKey
    )
  }
  if (rawId.startsWith('sfx.')) {
    if (rawId === 'sfx.thunder') {
      return wrapSvg(
        `
        <polyline points="64,6 50,25 62,25 52,46" stroke="${C_ACCENT}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="58" cy="26" r="18" stroke="${C_ACCENT_MID}" stroke-width="1.2" stroke-dasharray="3 2" />
        `,
        fullKey
      )
    }
    if (rawId === 'sfx.rainRoof') {
      return wrapSvg(
        `
        <line x1="26" y1="8" x2="20" y2="26" stroke="${C_ACCENT}" stroke-width="1.5" stroke-linecap="round" />
        <line x1="50" y1="8" x2="44" y2="26" stroke="${C_ACCENT}" stroke-width="1.5" stroke-linecap="round" />
        <line x1="74" y1="8" x2="68" y2="26" stroke="${C_ACCENT}" stroke-width="1.5" stroke-linecap="round" />
        <line x1="98" y1="8" x2="92" y2="26" stroke="${C_ACCENT}" stroke-width="1.5" stroke-linecap="round" />
        <polyline points="14,40 60,26 106,40" stroke="${C_STROKE}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        `,
        fullKey
      )
    }
    if (rawId === 'sfx.footsteps') {
      return wrapSvg(
        `
        <line x1="14" y1="38" x2="106" y2="38" stroke="${C_MUTED}" stroke-width="1.4" />
        <ellipse cx="38" cy="34" rx="7" ry="3.5" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
        <ellipse cx="76" cy="30" rx="7" ry="3.5" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" transform="rotate(-15 76 30)" />
        <path d="M28 42 Q38 46 48 42 M66 42 Q76 46 86 42" stroke="${C_ACCENT}" stroke-width="1.2" stroke-linecap="round" />
        `,
        fullKey
      )
    }
    if (rawId === 'sfx.whoosh') {
      return wrapSvg(
        `
        <path d="M16 18 Q60 8 104 22 M12 28 Q62 20 106 30 M22 38 Q64 32 98 38" stroke="${C_ACCENT}" stroke-width="1.8" stroke-linecap="round" fill="none" />
        `,
        fullKey
      )
    }
    if (rawId === 'sfx.doorCreak') {
      return wrapSvg(
        `
        <rect x="34" y="8" width="28" height="36" stroke="${C_MUTED}" stroke-width="1.3" />
        <polygon points="34,8 54,13 54,39 34,44" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" stroke-linejoin="round" />
        <path d="M64 20 Q76 26 64 32 M72 15 Q88 26 72 37" stroke="${C_ACCENT}" stroke-width="1.4" stroke-linecap="round" fill="none" />
        `,
        fullKey
      )
    }
    if (rawId === 'sfx.cityAmbience') {
      return wrapSvg(
        `
        <rect x="20" y="20" width="14" height="24" fill="${C_FAINT}" stroke="${C_STROKE}" stroke-width="1.3" />
        <rect x="38" y="10" width="18" height="34" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
        <rect x="60" y="16" width="16" height="28" fill="${C_FAINT}" stroke="${C_STROKE}" stroke-width="1.3" />
        <rect x="80" y="24" width="16" height="20" fill="${C_FAINT}" stroke="${C_MUTED}" stroke-width="1.2" />
        <line x1="12" y1="44" x2="108" y2="44" stroke="${C_ACCENT}" stroke-width="1.5" />
        `,
        fullKey
      )
    }
    return wrapSvg(
      `
      <circle cx="60" cy="26" r="5" fill="${C_ACCENT}" />
      <circle cx="60" cy="26" r="12" stroke="${C_ACCENT}" stroke-width="1.5" />
      <circle cx="60" cy="26" r="20" stroke="${C_MUTED}" stroke-width="1.2" stroke-dasharray="3 2" />
      `,
      fullKey
    )
  }
  if (rawId.startsWith('music.')) {
    if (rawId === 'music.ambientLoop') {
      return wrapSvg(
        `
        <path d="M14 26 Q36 10 60 26 T106 26" stroke="${C_ACCENT}" stroke-width="1.8" fill="none" />
        <path d="M14 32 Q36 18 60 32 T106 32" stroke="${C_MUTED}" stroke-width="1.3" fill="none" />
        `,
        fullKey
      )
    }
    if (rawId === 'music.emotionalPiano') {
      return wrapSvg(
        `
        <rect x="22" y="10" width="76" height="32" rx="3" fill="${C_FAINT}" stroke="${C_STROKE}" stroke-width="1.4" />
        <line x1="37" y1="10" x2="37" y2="42" stroke="${C_MUTED}" stroke-width="1.1" />
        <line x1="52" y1="10" x2="52" y2="42" stroke="${C_MUTED}" stroke-width="1.1" />
        <line x1="68" y1="10" x2="68" y2="42" stroke="${C_MUTED}" stroke-width="1.1" />
        <line x1="83" y1="10" x2="83" y2="42" stroke="${C_MUTED}" stroke-width="1.1" />
        <rect x="33" y="10" width="8" height="19" fill="${C_ACCENT}" />
        <rect x="48" y="10" width="8" height="19" fill="${C_ACCENT}" />
        <rect x="79" y="10" width="8" height="19" fill="${C_ACCENT}" />
        `,
        fullKey
      )
    }
    if (rawId === 'music.lofiStudy') {
      return wrapSvg(
        `
        <circle cx="60" cy="26" r="18" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.5" />
        <circle cx="60" cy="26" r="11" stroke="${C_MUTED}" stroke-width="1" stroke-dasharray="3 2" />
        <circle cx="60" cy="26" r="4" fill="${C_ACCENT}" />
        `,
        fullKey
      )
    }
    return wrapSvg(
      `
      <rect x="20" y="28" width="6" height="14" rx="2" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.2" />
      <rect x="32" y="18" width="6" height="24" rx="2" fill="${C_ACCENT}" />
      <rect x="44" y="10" width="6" height="32" rx="2" fill="${C_ACCENT}" />
      <rect x="56" y="22" width="6" height="20" rx="2" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.2" />
      <rect x="68" y="14" width="6" height="28" rx="2" fill="${C_ACCENT}" />
      <rect x="80" y="24" width="6" height="18" rx="2" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.2" />
      <circle cx="96" cy="34" r="4" fill="${C_ACCENT}" />
      <path d="M100 34 V14 L108 17 V23 L100 20" stroke="${C_ACCENT}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      `,
      fullKey
    )
  }

  // 7. 反推提示词 (toPrompt.*) 与 提示词优化 (optimize.*)
  if (rawId.startsWith('toPrompt.')) {
    const isGame = rawId.includes('.game.')
    const isFilm = rawId.includes('.film.')
    const leftGlyph = isGame
      ? `<polygon points="32,14 42,20 42,32 32,38 22,32 22,20" fill="${C_FAINT}" stroke="${C_ACCENT}" stroke-width="1.4"/>`
      : isFilm
        ? `<rect x="18" y="15" width="28" height="22" rx="2" stroke="${C_ACCENT}" stroke-width="1.4"/><line x1="18" y1="20" x2="46" y2="20" stroke="${C_ACCENT}" stroke-width="1.2"/>`
        : `<circle cx="32" cy="24" r="8" stroke="${C_ACCENT}" stroke-width="1.4" /><line x1="38" y1="30" x2="44" y2="36" stroke="${C_ACCENT}" stroke-width="1.8" stroke-linecap="round" />`
    return wrapSvg(
      `
      <rect x="14" y="9" width="36" height="34" rx="3" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
      ${leftGlyph}
      <path d="M54 26 H66 M62 22 L67 26 L62 30" stroke="${C_ACCENT}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      <line x1="72" y1="15" x2="106" y2="15" stroke="${C_ACCENT}" stroke-width="2" stroke-linecap="round" />
      <line x1="72" y1="25" x2="102" y2="25" stroke="${C_STROKE}" stroke-width="2" stroke-linecap="round" />
      <line x1="72" y1="35" x2="94" y2="35" stroke="${C_MUTED}" stroke-width="2" stroke-linecap="round" />
      `,
      fullKey
    )
  }
  if (rawId.startsWith('optimize.')) {
    if (rawId === 'optimize.episodeBeatBoard') {
      return wrapSvg(renderGridSvg(3, 3, 'beatBoard'), fullKey)
    }
    if (rawId === 'optimize.episodeSequenceBoard') {
      return wrapSvg(renderGridSvg(4, 1, 'seqBoard'), fullKey)
    }
    return wrapSvg(
      `
      <line x1="14" y1="20" x2="36" y2="20" stroke="${C_MUTED}" stroke-width="2" stroke-linecap="round" />
      <line x1="14" y1="30" x2="30" y2="30" stroke="${C_MUTED}" stroke-width="2" stroke-linecap="round" />
      <polygon points="56,12 59,22 69,25 59,28 56,38 53,28 43,25 53,22" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" stroke-linejoin="round" />
      <rect x="74" y="10" width="34" height="32" rx="3" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
      <line x1="80" y1="18" x2="102" y2="18" stroke="${C_ACCENT}" stroke-width="1.6" stroke-linecap="round" />
      <line x1="80" y1="26" x2="102" y2="26" stroke="${C_STROKE}" stroke-width="1.6" stroke-linecap="round" />
      <line x1="80" y1="34" x2="96" y2="34" stroke="${C_STROKE}" stroke-width="1.6" stroke-linecap="round" />
      `,
      fullKey
    )
  }

  // 8. 2D 帧动画 (anim2d.* / wushu.* / fx.*)
  if (rawId.startsWith('anim2d.')) {
    const sub = rawId.slice('anim2d.'.length)
    if (
      sub === 'idle' ||
      sub === 'walk' ||
      sub === 'run' ||
      sub === 'jump' ||
      sub === 'dash' ||
      sub === 'attack' ||
      sub === 'combo' ||
      sub === 'hurt' ||
      sub === 'skill' ||
      sub === 'death'
    ) {
      const mapPose: Record<string, string> = {
        idle: 'idle',
        walk: 'walk',
        run: 'run',
        jump: 'jumpAir',
        dash: 'run',
        attack: 'fightGuard',
        combo: 'fightGuard',
        hurt: 'hitReact',
        skill: 'celebrate',
        death: 'death'
      }
      return wrapSvg(renderPoseSkeleton(mapPose[sub] ?? 'walk', true), fullKey)
    }
    return wrapSvg(
      renderGridSvg(input.visual.grid?.cols ?? 4, input.visual.grid?.rows ?? 1, rawId),
      fullKey
    )
  }
  if (rawId.startsWith('wushu.')) {
    if (rawId === 'wushu.taiji') {
      return wrapSvg(
        `
        <circle cx="60" cy="26" r="17" stroke="${C_ACCENT}" stroke-width="1.6" fill="${C_ACCENT_SOFT}" />
        <path d="M60 9 A8.5 8.5 0 0 1 60 26 A8.5 8.5 0 0 0 60 43" stroke="${C_ACCENT}" stroke-width="1.5" fill="none" />
        <circle cx="60" cy="17.5" r="2.2" fill="${C_ACCENT}" />
        <circle cx="60" cy="34.5" r="2.2" fill="${C_STROKE}" />
        `,
        fullKey
      )
    }
    if (rawId === 'wushu.jinzhongzhao') {
      return wrapSvg(
        `
        ${renderPoseSkeleton('idle', false)}
        <path d="M36 45 V22 A24 20 0 0 1 84 22 V45" stroke="${C_ACCENT}" stroke-width="1.8" stroke-dasharray="4 2" fill="${C_ACCENT_SOFT}" />
        `,
        fullKey
      )
    }
    if (rawId === 'wushu.yiyangzhi' || rawId === 'wushu.liumai' || rawId === 'wushu.dianxue') {
      return wrapSvg(
        `
        ${renderPoseSkeleton('point', false)}
        <line x1="82" y1="18" x2="110" y2="18" stroke="${C_ACCENT}" stroke-width="2.2" stroke-linecap="round" />
        ${rawId === 'wushu.liumai' ? `<line x1="82" y1="15" x2="108" y2="10" stroke="${C_ACCENT}" stroke-width="1.5" stroke-linecap="round"/><line x1="82" y1="21" x2="108" y2="26" stroke="${C_ACCENT}" stroke-width="1.5" stroke-linecap="round"/>` : ''}
        `,
        fullKey
      )
    }
    if (rawId === 'wushu.wuyingjiao' || rawId === 'wushu.tiyunzong') {
      return wrapSvg(renderPoseSkeleton('jumpAir', true), fullKey)
    }
    return wrapSvg(
      `
      ${renderPoseSkeleton('fightGuard', false)}
      <path d="M74 14 Q96 24 74 36" stroke="${C_ACCENT}" stroke-width="2" fill="none" stroke-linecap="round" />
      <path d="M80 10 Q106 24 80 40" stroke="${C_ACCENT_MID}" stroke-width="1.4" fill="none" stroke-linecap="round" />
      `,
      fullKey
    )
  }
  if (rawId.startsWith('fx.')) {
    if (rawId === 'fx.slash') {
      return wrapSvg(
        `<path d="M22 40 Q62 4 98 32 Q66 18 22 40 Z" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.6" stroke-linejoin="round" />`,
        fullKey
      )
    }
    if (rawId === 'fx.fire' || rawId === 'fx.embers') {
      return wrapSvg(
        `<path d="M60 7 C74 20 78 32 68 42 C64 46 56 46 52 42 C42 32 46 20 60 7 Z" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.6" stroke-linejoin="round" />`,
        fullKey
      )
    }
    if (rawId === 'fx.water' || rawId === 'fx.shockwave' || rawId === 'fx.glow') {
      return wrapSvg(
        `
        <ellipse cx="60" cy="28" rx="14" ry="6" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.6" />
        <ellipse cx="60" cy="28" rx="28" ry="12" stroke="${C_ACCENT}" stroke-width="1.3" stroke-dasharray="4 2" />
        <ellipse cx="60" cy="28" rx="42" ry="17" stroke="${C_MUTED}" stroke-width="1.1" stroke-dasharray="3 3" />
        `,
        fullKey
      )
    }
    if (rawId === 'fx.lightning') {
      return wrapSvg(
        `<polyline points="66,5 48,25 63,25 50,47" stroke="${C_ACCENT}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />`,
        fullKey
      )
    }
    if (rawId === 'fx.projectile') {
      return wrapSvg(
        `
        <path d="M18 26 H78" stroke="${C_ACCENT}" stroke-width="3" stroke-linecap="round" stroke-dasharray="6 3" />
        <circle cx="88" cy="26" r="9" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.8" />
        <circle cx="88" cy="26" r="4" fill="${C_ACCENT}" />
        `,
        fullKey
      )
    }
    return wrapSvg(
      `
      <polygon points="60,6 66,19 80,14 72,26 84,36 68,35 60,46 52,35 36,36 48,26 40,14 54,19" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.5" stroke-linejoin="round" />
      `,
      fullKey
    )
  }

  // 9. SVG 生成 (svgGen) 与 可玩 HTML (gameHtmlGen)
  if (kind === 'svgGen' || fullKey.startsWith('svgGen.')) {
    if (rawId.includes('loading')) {
      return wrapSvg(
        `
        <path d="M60 10 A16 16 0 1 1 44 26" stroke="${C_ACCENT}" stroke-width="2.6" stroke-linecap="round" fill="none" />
        <polyline points="40,22 44,27 49,23" stroke="${C_ACCENT}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        `,
        fullKey
      )
    }
    if (rawId.includes('button')) {
      return wrapSvg(
        `
        <rect x="24" y="15" width="72" height="22" rx="11" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.6" />
        <line x1="44" y1="26" x2="76" y2="26" stroke="${C_ACCENT}" stroke-width="2" stroke-linecap="round" />
        `,
        fullKey
      )
    }
    if (rawId.includes('badge')) {
      return wrapSvg(
        `
        <polygon points="60,7 82,16 76,40 60,46 44,40 38,16" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.6" stroke-linejoin="round" />
        <circle cx="60" cy="26" r="7" fill="${C_FAINT}" stroke="${C_ACCENT}" stroke-width="1.3" />
        `,
        fullKey
      )
    }
    return wrapSvg(
      `
      <path d="M26 38 C26 14 94 14 94 38" stroke="${C_ACCENT}" stroke-width="1.8" fill="none" />
      <line x1="26" y1="38" x2="44" y2="14" stroke="${C_MUTED}" stroke-width="1.1" stroke-dasharray="2 2" />
      <line x1="94" y1="38" x2="76" y2="14" stroke="${C_MUTED}" stroke-width="1.1" stroke-dasharray="2 2" />
      <rect x="23" y="35" width="6" height="6" fill="${C_ACCENT}" />
      <rect x="91" y="35" width="6" height="6" fill="${C_ACCENT}" />
      <circle cx="44" cy="14" r="3" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.3" />
      <circle cx="76" cy="14" r="3" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.3" />
      `,
      fullKey
    )
  }
  if (kind === 'gameHtmlGen' || fullKey.startsWith('gameHtmlGen.')) {
    const is3d = rawId.includes('3d')
    return wrapSvg(
      is3d
        ? `
          <polygon points="60,12 96,26 60,42 24,26" fill="${C_FAINT}" stroke="${C_MUTED}" stroke-width="1.2" />
          <polygon points="60,14 70,19 60,24 50,19" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.5" />
          <circle cx="80" cy="26" r="3.5" fill="${C_ACCENT}" />
        `
        : `
          <rect x="18" y="8" width="84" height="36" rx="4" fill="${C_FAINT}" stroke="${C_STROKE}" stroke-width="1.3" />
          <circle cx="42" cy="26" r="6" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.6" />
          <circle cx="66" cy="18" r="2.8" fill="${C_ACCENT}" />
          <circle cx="80" cy="28" r="2.8" fill="${C_ACCENT}" />
          <circle cx="72" cy="36" r="2.8" fill="${C_ACCENT}" />
        `,
      fullKey
    )
  }

  // 10. 3D 姿势 / 3D 动画 / 3D 拆件 / 3D 重定向 / 3D 贴图 / 3D 绑骨 / 空间世界 / 语义编译
  if (kind === 'modelPose' || fullKey.startsWith('modelPose.')) {
    const poseId = rawId.replace(/^modelPose\./, '')
    return wrapSvg(renderPoseSkeleton(poseId, false), fullKey)
  }
  if (kind === 'modelAnimation' || fullKey.startsWith('modelAnimation.')) {
    const poseId = rawId.replace(/^modelAnimation\./, '')
    return wrapSvg(renderPoseSkeleton(poseId, true), fullKey)
  }
  if (kind === 'modelSegment' || fullKey.startsWith('modelSegment.')) {
    return wrapSvg(
      `
      <rect x="44" y="6" width="32" height="14" rx="2" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
      <rect x="20" y="26" width="34" height="18" rx="2" fill="${C_FAINT}" stroke="${C_STROKE}" stroke-width="1.3" />
      <rect x="66" y="26" width="34" height="18" rx="2" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" />
      <line x1="16" y1="23" x2="104" y2="23" stroke="${C_ACCENT}" stroke-width="1.2" stroke-dasharray="3 2" />
      `,
      fullKey
    )
  }
  if (kind === 'modelRetarget' || fullKey.startsWith('modelRetarget.')) {
    const targetPose = rawId.includes('hurt')
      ? 'hitReact'
      : rawId.includes('Jump')
        ? 'jumpAir'
        : rawId.includes('dance')
          ? 'celebrate'
          : 'run'
    return wrapSvg(
      `
      <g transform="translate(-24, 0) scale(0.9)">${renderPoseSkeleton('idle', false)}</g>
      <path d="M50 26 H68 M63 22 L69 26 L63 30" stroke="${C_ACCENT}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      <g transform="translate(26, 0) scale(0.9)">${renderPoseSkeleton(targetPose, false)}</g>
      `,
      fullKey
    )
  }
  if (kind === 'modelTexture' || fullKey.startsWith('modelTexture.')) {
    const texId = rawId.replace(/^modelTexture\./, '')
    const detail =
      texId === 'brushedMetal' || texId === 'glass'
        ? `<line x1="48" y1="38" x2="72" y2="14" stroke="${C_ACCENT}" stroke-width="1.5"/><line x1="54" y1="40" x2="76" y2="18" stroke="${C_MUTED}" stroke-width="1.1"/>`
        : texId === 'cyberpunk'
          ? `<polyline points="44,26 56,26 60,18 76,18" stroke="${C_ACCENT}" stroke-width="1.6"/>`
          : `<ellipse cx="60" cy="26" rx="18" ry="7" stroke="${C_MUTED}" stroke-width="1.1" stroke-dasharray="3 2" /><ellipse cx="60" cy="26" rx="7" ry="18" stroke="${C_MUTED}" stroke-width="1.1" stroke-dasharray="3 2" />`
    return wrapSvg(
      `
      <circle cx="60" cy="26" r="18" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.6" />
      ${detail}
      <circle cx="53" cy="18" r="3.5" fill="${C_ACCENT}" opacity="0.65" />
      `,
      fullKey
    )
  }
  if (kind === 'modelRigSkin' || fullKey.startsWith('modelRigSkin.')) {
    const isQuad = rawId.includes('quadruped')
    return wrapSvg(
      isQuad
        ? `
          <line x1="34" y1="22" x2="82" y2="22" stroke="${C_ACCENT}" stroke-width="2" />
          <circle cx="28" cy="16" r="4.5" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.5" />
          <line x1="40" y1="22" x2="38" y2="42" stroke="${C_STROKE}" stroke-width="1.8" />
          <line x1="50" y1="22" x2="48" y2="42" stroke="${C_STROKE}" stroke-width="1.8" />
          <line x1="72" y1="22" x2="70" y2="42" stroke="${C_STROKE}" stroke-width="1.8" />
          <line x1="82" y1="22" x2="84" y2="42" stroke="${C_STROKE}" stroke-width="1.8" />
        `
        : renderPoseSkeleton('idle', false),
      fullKey
    )
  }
  if (kind === 'spatialWorld' || fullKey.startsWith('spatialWorld.')) {
    return wrapSvg(
      `
      <polygon points="60,6 104,18 104,38 60,46 16,38 16,18" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" stroke-linejoin="round" />
      <line x1="60" y1="6" x2="60" y2="28" stroke="${C_MUTED}" stroke-width="1.1" stroke-dasharray="2 2" />
      <line x1="16" y1="38" x2="60" y2="28" stroke="${C_MUTED}" stroke-width="1.1" stroke-dasharray="2 2" />
      <line x1="104" y1="38" x2="60" y2="28" stroke="${C_MUTED}" stroke-width="1.1" stroke-dasharray="2 2" />
      `,
      fullKey
    )
  }
  if (kind === 'semanticCompile' || fullKey.startsWith('semanticCompile.')) {
    return wrapSvg(
      `
      ${viewfinderFrame(16, 6, 88, 40)}
      ${personSilhouette(46, 14, 0.78, true)}
      <line x1="68" y1="18" x2="94" y2="18" stroke="${C_ACCENT}" stroke-width="1.6" stroke-linecap="round" />
      <line x1="68" y1="26" x2="90" y2="26" stroke="${C_STROKE}" stroke-width="1.5" stroke-linecap="round" />
      <line x1="68" y1="34" x2="84" y2="34" stroke="${C_MUTED}" stroke-width="1.5" stroke-linecap="round" />
      `,
      fullKey
    )
  }

  // 11. 通用 visual.kind 兜底示意图
  const v = input.visual
  if (v.kind === 'grid') {
    return wrapSvg(renderGridSvg(v.grid?.cols ?? 3, v.grid?.rows ?? 3, rawId), fullKey || 'grid')
  }
  if (v.kind === 'shotSize') {
    return wrapSvg(renderShotSizeSvg(v.shotSize, rawId), fullKey || 'shotSize')
  }
  if (v.kind === 'camera') {
    return wrapSvg(renderCameraSvg(v.camera, rawId), fullKey || 'camera')
  }
  if (v.kind === 'facing') {
    return wrapSvg(renderFacingSvg(v.facing, rawId), fullKey || 'facing')
  }
  if (v.kind === 'lighting') {
    return wrapSvg(renderLightingSvg(v.lighting), fullKey || 'lighting')
  }
  if (v.kind === 'mood') {
    return wrapSvg(renderMoodSvg(v.mood, rawId), fullKey || 'mood')
  }

  return wrapSvg(
    `
    ${viewfinderFrame(18, 6, 84, 40)}
    <polygon points="60,13 63,22 72,25 63,28 60,37 57,28 48,25 57,22" fill="${C_ACCENT_SOFT}" stroke="${C_ACCENT}" stroke-width="1.4" stroke-linejoin="round" />
    `,
    fullKey || 'default'
  )
}
