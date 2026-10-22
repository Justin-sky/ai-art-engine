/**
 * 剪映式时间线创意特效与调色包（特效 / 转场 / 滤镜 / 调节 / 模板）
 *
 * 双引擎同构契约：
 * - Web 预览端：60fps 实时 CSS filter / transform / 舞台叠加层（buildClipVisualCssFilter / buildClipVisualCssTransform / buildClipVisualOverlayMeta）
 * - FFmpeg 导出端：标准滤镜链编译（buildClipVisualFfmpegFilter）
 */
import type {
  ScriptTimelineClip,
  ScriptTimelineSettings,
  ScriptTimelineSource,
  ScriptTimelineTransitionType
} from './scriptTimeline'
import type {
  TimelineMainCameraPreset,
  TimelineTweenInPreset,
  TimelineTweenOutPreset
} from './timelineTween'

export type TimelineBrowserTabId =
  'sources' | 'effects' | 'transitions' | 'filters' | 'adjustments' | 'templates'

export type TimelineFilterPresetId =
  | 'none'
  | 'black-gold'
  | 'teal-orange'
  | 'cyberpunk'
  | 'blade-runner'
  | 'dune-sand'
  | 'matrix-green'
  | 'noir-bw'
  | 'fuji-classic'
  | 'kodak-portra'
  | 'agfa-vista'
  | 'polaroid-fade'
  | 'hk-retro'
  | 'vintage-sepia'
  | 'cream-skin'
  | 'peach-oolong'
  | 'cold-porcelain'
  | 'japanese-fresh'
  | 'kamakura-sea'
  | 'emerald-forest'
  | 'sunset-glow'
  | 'golden-autumn'
  | 'nordic-cold'
  | 'anime-vivid'
  | 'morandi-gray'
  | 'vaporwave'

export type TimelineVisualEffectId =
  | 'none'
  | 'rgb-glitch'
  | 'bad-tv'
  | 'neon-edge'
  | 'cyber-matrix'
  | 'pixel-mosaic'
  | 'camera-shake'
  | 'earthquake'
  | 'beat-pulse'
  | 'soul-out'
  | 'strobe-flash'
  | 'pendulum-swing'
  | 'zoom-burst'
  | 'dreamy-bloom'
  | 'gold-sparkle'
  | 'sunset-leak'
  | 'neon-halo'
  | 'blur-focus'
  | 'tilt-shift'
  | 'vhs-retro'
  | 'old-film'
  | 'dv-cam'
  | 'posterize-pop'
  | 'negative-invert'
  | 'cinema-letterbox'
  | 'bw-spotlight'
  | 'thermal-vision'
  | 'night-vision'
  | 'split-2h'
  | 'split-3v'
  | 'split-4grid'

export type TimelineCreativeTemplateId =
  | 'high-energy-beat'
  | 'black-gold-cinema'
  | 'cyber-neon-drama'
  | 'fuji-vlog'
  | 'hk-retro-memory'
  | 'japanese-fresh-album'
  | 'noir-documentary'
  | 'vhs-retro-tape'
  | 'anime-opening'
  | 'peach-fashion-lookbook'
  | 'dune-epic-trailer'
  | 'vaporwave-party'

export interface TimelineClipCreativeProps {
  /** 亮度 (-0.5..0.5, 缺省 0) */
  brightness?: number
  /** 对比度 (0.5..2, 缺省 1) */
  contrast?: number
  /** 饱和度 (0..3, 缺省 1) */
  saturation?: number
  /** 自然饱和度 (-100..100, 缺省 0) */
  vibrance?: number
  /** 色温 (-100..100, 缺省 0；<0 冷蓝，>0 暖黄) */
  temperature?: number
  /** 色调 (-100..100, 缺省 0；<0 偏绿，>0 偏洋红) */
  tint?: number
  /** 高光 (-100..100, 缺省 0) */
  highlights?: number
  /** 阴影 (-100..100, 缺省 0) */
  shadows?: number
  /** 锐化 (0..100, 缺省 0) */
  sharpen?: number
  /** 暗角 (0..100, 缺省 0) */
  vignette?: number
  /** 褪色 / 胶片灰雾 (0..100, 缺省 0) */
  fade?: number
  /** 胶片颗粒 (0..100, 缺省 0) */
  grain?: number
  /** 滤镜预设 ID */
  filterPreset?: TimelineFilterPresetId
  /** 滤镜强度 (0..100, 缺省 100) */
  filterIntensity?: number
  /** 画面特效 ID */
  visualEffect?: TimelineVisualEffectId
  /** 特效强度 (0..100, 缺省 75) */
  effectIntensity?: number
}

export interface TimelineBrowserTabMeta {
  id: TimelineBrowserTabId
  labelZh: string
  labelEn: string
  iconPath: string
}

export const TIMELINE_BROWSER_TABS: readonly TimelineBrowserTabMeta[] = [
  {
    id: 'sources',
    labelZh: '素材',
    labelEn: 'Media',
    iconPath:
      'M3 4.5h14a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 17 15.5H3A1.5 1.5 0 0 1 1.5 14V6A1.5 1.5 0 0 1 3 4.5Zm-1.5 3h17M6.5 4.5 5 7.5m6-3-1.5 3m6-3-1.5 3'
  },
  {
    id: 'effects',
    labelZh: '特效',
    labelEn: 'Effects',
    iconPath:
      'M10 2.2 11.7 6.8 16.5 8.5 11.7 10.2 10 14.8 8.3 10.2 3.5 8.5 8.3 6.8 10 2.2Zm5.5 11 0.7 1.8 1.8 0.7-1.8 0.7-0.7 1.8-0.7-1.8-1.8-0.7 1.8-0.7 0.7-1.8Z'
  },
  {
    id: 'transitions',
    labelZh: '转场',
    labelEn: 'Transitions',
    iconPath: 'M3.5 4.5 9.5 10l-6 5.5V4.5Zm13 0L10.5 10l6 5.5V4.5Z'
  },
  {
    id: 'filters',
    labelZh: '滤镜',
    labelEn: 'Filters',
    iconPath: 'M8 8.2a4.2 4.2 0 1 0 0 .01Zm4.2 0a4.2 4.2 0 1 0 0 .01Zm-2.1 3.8a4.2 4.2 0 1 0 0 .01Z'
  },
  {
    id: 'adjustments',
    labelZh: '调节',
    labelEn: 'Adjust',
    iconPath:
      'M3.5 6h13M3.5 10h13M3.5 14h13M7.5 4.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Zm5.3 4a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Zm-3.8 4a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Z'
  },
  {
    id: 'templates',
    labelZh: '模板',
    labelEn: 'Templates',
    iconPath: 'M3 3.5h14v5H3v-5Zm0 7h6.2v6H3v-6Zm7.8 0H17v6h-6.2v-6Z'
  }
] as const

export type TimelineVisualEffectCategory =
  'all' | 'dynamic' | 'atmosphere' | 'cyber' | 'split' | 'retro' | 'cinema'

export interface TimelineVisualEffectMeta {
  id: TimelineVisualEffectId
  category: Exclude<TimelineVisualEffectCategory, 'all'>
  labelZh: string
  labelEn: string
  descZh: string
  descEn: string
  badge: string
  accent: string
  previewGradient: string
  /** 20x20 SVG path */
  iconPath: string
}

export const TIMELINE_VISUAL_EFFECT_CATEGORIES: readonly {
  id: TimelineVisualEffectCategory
  labelZh: string
  labelEn: string
  iconPath: string
}[] = [
  {
    id: 'all',
    labelZh: '全部',
    labelEn: 'All',
    iconPath:
      'M3.5 3.5h5.2v5.2H3.5V3.5Zm7.8 0h5.2v5.2h-5.2V3.5ZM3.5 11.3h5.2v5.2H3.5v-5.2Zm7.8 0h5.2v5.2h-5.2v-5.2Z'
  },
  {
    id: 'dynamic',
    labelZh: '动感卡点',
    labelEn: 'Dynamic',
    iconPath: 'M11.2 2.5 4.5 11h5.2l-1 6.5L15.5 9h-5.2l0.9-6.5Z'
  },
  {
    id: 'atmosphere',
    labelZh: '光影氛围',
    labelEn: 'Atmosphere',
    iconPath: 'M10 2.5 11.8 7l4.7 1.8-4.7 1.8L10 15.3 8.2 10.6 3.5 8.8 8.2 7 10 2.5Z'
  },
  {
    id: 'cyber',
    labelZh: '赛博故障',
    labelEn: 'Glitch',
    iconPath: 'M3 6h10M7 10h10M4 14h9M15 5l2 2-2 2M5 11l-2 2 2 2'
  },
  {
    id: 'split',
    labelZh: '分屏多格',
    labelEn: 'Split',
    iconPath: 'M3 4h14v12H3V4Zm7 0v12M3 10h14'
  },
  {
    id: 'retro',
    labelZh: '复古胶片',
    labelEn: 'Retro',
    iconPath: 'M3 5h14v10H3V5Zm3.5 5a1.8 1.8 0 1 0 0 .01Zm7 0a1.8 1.8 0 1 0 0 .01ZM6.5 12h7'
  },
  {
    id: 'cinema',
    labelZh: '电影质感',
    labelEn: 'Cinema',
    iconPath: 'M2.5 4.5h15v11h-15v-11ZM2.5 7.2h15M2.5 12.8h15'
  }
] as const

export const TIMELINE_VISUAL_EFFECTS: readonly TimelineVisualEffectMeta[] = [
  {
    id: 'none',
    category: 'cinema',
    labelZh: '无特效',
    labelEn: 'None',
    descZh: '保持原始画面，不叠加额外视觉特效',
    descEn: 'Keep original picture without visual effects',
    badge: 'OFF',
    accent: '#64748b',
    previewGradient: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
    iconPath: 'M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM5.4 5.4l9.2 9.2'
  },
  {
    id: 'rgb-glitch',
    category: 'cyber',
    labelZh: '故障色差',
    labelEn: 'RGB Glitch',
    descZh: '赛博朋克红蓝通道分离与微幅高频错位',
    descEn: 'Cyberpunk RGB chromatic aberration and micro jitter',
    badge: 'RGB',
    accent: '#ec4899',
    previewGradient: 'linear-gradient(135deg, #ff0055 0%, #1e1b4b 50%, #00f0ff 100%)',
    iconPath: 'M4 6h9M7 10h9M5 14h8M14 4.5l2.5 1.5-2.5 1.5M6 12.5 3.5 14 6 15.5'
  },
  {
    id: 'bad-tv',
    category: 'cyber',
    labelZh: '信号干扰',
    labelEn: 'Bad TV',
    descZh: '模拟老电视横纹雪花干扰与高频横向撕裂',
    descEn: 'Analog TV horizontal sync tear and static interference',
    badge: 'TV',
    accent: '#06b6d4',
    previewGradient: 'linear-gradient(180deg, #0f172a 0%, #0891b2 35%, #1e293b 65%, #f43f5e 100%)',
    iconPath: 'M3.5 6h13v10h-13V6ZM7 2.5 10 6l3-3.5M5.5 9.5h9M5.5 12.5h6'
  },
  {
    id: 'neon-edge',
    category: 'cyber',
    labelZh: '霓虹发光',
    labelEn: 'Neon Glow',
    descZh: '高饱和电光紫青色相轮转与边缘发光晕染',
    descEn: 'Electric neon hue shift and glowing edge halation',
    badge: 'NEON',
    accent: '#c084fc',
    previewGradient: 'linear-gradient(135deg, #2e1065 0%, #a855f7 50%, #22d3ee 100%)',
    iconPath: 'M10 2.8 12.2 7.5l5.1.7-3.7 3.6.9 5.1L10 14.5l-4.5 2.4.9-5.1-3.7-3.6 5.1-.7L10 2.8Z'
  },
  {
    id: 'cyber-matrix',
    category: 'cyber',
    labelZh: '赛博矩阵',
    labelEn: 'Matrix Code',
    descZh: '黑客帝国数字冷绿矩阵影调与扫描高反差',
    descEn: 'Digital emerald matrix tint with crisp scanlines',
    badge: 'MTX',
    accent: '#10b981',
    previewGradient: 'linear-gradient(135deg, #022c22 0%, #059669 55%, #6ee7b7 100%)',
    iconPath: 'M5 3.5v13M10 3.5v13M15 3.5v13M3.5 7.5h3M8.5 11.5h3M13.5 6.5h3'
  },
  {
    id: 'pixel-mosaic',
    category: 'cyber',
    labelZh: '像素马赛克',
    labelEn: 'Pixel Mosaic',
    descZh: '8-Bit 复古游戏风像素化与锐利色块感',
    descEn: '8-bit retro arcade pixelation and blocky contrast',
    badge: '8BIT',
    accent: '#818cf8',
    previewGradient: 'linear-gradient(135deg, #312e81 0%, #6366f1 50%, #f472b6 100%)',
    iconPath: 'M4 4h4v4H4V4Zm4 4h4v4H8V8Zm4-4h4v4h-4V4ZM4 12h4v4H4v-4Zm8 0h4v4h-4v-4Z'
  },
  {
    id: 'camera-shake',
    category: 'dynamic',
    labelZh: '动感震屏',
    labelEn: 'Camera Shake',
    descZh: '高能冲击镜头震动与边缘安全扩幅',
    descEn: 'High-impact handheld camera shake with safe overscan',
    badge: 'SHAKE',
    accent: '#f97316',
    previewGradient: 'linear-gradient(135deg, #7c2d12 0%, #ea580c 55%, #facc15 100%)',
    iconPath: 'M5.5 5.5h9v9h-9v-9ZM2.5 7l1.5 1.5L2.5 10m15-3-1.5 1.5L17.5 10M7 2.5 8.5 4 10 2.5'
  },
  {
    id: 'earthquake',
    category: 'dynamic',
    labelZh: '剧烈地动',
    labelEn: 'Earthquake',
    descZh: '重低音爆点重度纵向震荡与色差冲击',
    descEn: 'Heavy bass drop vertical tremor with RGB shock',
    badge: 'QUAKE',
    accent: '#ef4444',
    previewGradient: 'linear-gradient(135deg, #450a0a 0%, #dc2626 52%, #fb923c 100%)',
    iconPath: 'M2.5 10h3l2-5 3 10 2.5-7 1.5 2h3'
  },
  {
    id: 'beat-pulse',
    category: 'dynamic',
    labelZh: '律动脉冲',
    labelEn: 'Beat Pulse',
    descZh: '随节拍周期性呼吸缩放与高光增强',
    descEn: 'Rhythmic zoom pulse and highlight boost',
    badge: 'PULSE',
    accent: '#a855f7',
    previewGradient: 'linear-gradient(135deg, #3b0764 0%, #9333ea 55%, #f472b6 100%)',
    iconPath:
      'M10 5.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Zm0-3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Z'
  },
  {
    id: 'soul-out',
    category: 'dynamic',
    labelZh: '灵魂出窍',
    labelEn: 'Soul Out',
    descZh: '剪映经典残影放大抽离与重影高光脉冲',
    descEn: 'Classic CapCut astral projection zoom ghosting',
    badge: 'SOUL',
    accent: '#ec4899',
    previewGradient: 'radial-gradient(circle at 50% 50%, #f472b6 0%, #7e22ce 52%, #0f172a 100%)',
    iconPath: 'M7.5 6.5h7v7h-7v-7Zm-2-2h7v7h-7v-7Zm4 4h7v7h-7v-7Z'
  },
  {
    id: 'strobe-flash',
    category: 'dynamic',
    labelZh: '频闪卡点',
    labelEn: 'Strobe Flash',
    descZh: '快节奏明暗频闪与反差爆发',
    descEn: 'Fast rhythmic exposure strobe and contrast burst',
    badge: 'FLASH',
    accent: '#eab308',
    previewGradient: 'linear-gradient(135deg, #422006 0%, #ca8a04 50%, #fef08a 100%)',
    iconPath: 'M11 2.2 4.5 10.8h5l-1 7L15.5 9.2h-5l0.5-7Z'
  },
  {
    id: 'pendulum-swing',
    category: 'dynamic',
    labelZh: '钟摆摇晃',
    labelEn: 'Pendulum',
    descZh: '随音乐律动左右微幅摇摆运镜',
    descEn: 'Rhythmic left-right pendulum tilt motion',
    badge: 'SWING',
    accent: '#14b8a6',
    previewGradient: 'linear-gradient(135deg, #042f2e 0%, #0d9488 55%, #5eead4 100%)',
    iconPath:
      'M10 3v9m0 0a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4ZM4.5 13.5c1.5 2 3.5 3 5.5 3s4-1 5.5-3'
  },
  {
    id: 'zoom-burst',
    category: 'dynamic',
    labelZh: '急推冲击',
    labelEn: 'Zoom Burst',
    descZh: '开场高速推进放大至主体定格',
    descEn: 'Rapid punch-in zoom burst at clip entrance',
    badge: 'ZOOM',
    accent: '#f43f5e',
    previewGradient: 'radial-gradient(circle at 50% 50%, #fda4af 0%, #e11d48 55%, #1e1b4b 100%)',
    iconPath: 'M3.5 3.5 8 8m8.5-4.5L12 8M3.5 16.5 8 12m8.5 4.5L12 12'
  },
  {
    id: 'dreamy-bloom',
    category: 'atmosphere',
    labelZh: '柔光梦幻',
    labelEn: 'Dreamy Bloom',
    descZh: '柔焦高光弥散与浪漫暖调柔化',
    descEn: 'Soft highlight halation and dreamy warm glow',
    badge: 'BLOOM',
    accent: '#f472b6',
    previewGradient: 'linear-gradient(135deg, #831843 0%, #ec4899 50%, #fde68a 100%)',
    iconPath: 'M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm0-2v2m0 12v2m-8-8h2m12 0h2'
  },
  {
    id: 'gold-sparkle',
    category: 'atmosphere',
    labelZh: '星光闪闪',
    labelEn: 'Star Sparkle',
    descZh: '金色四角星芒闪烁与通透高光提亮',
    descEn: 'Twinkling golden starlight flares and specular boost',
    badge: 'STAR',
    accent: '#fbbf24',
    previewGradient: 'linear-gradient(135deg, #451a03 0%, #d97706 48%, #fef08a 100%)',
    iconPath:
      'M10 2l1.6 5.4L17 9l-5.4 1.6L10 16l-1.6-5.4L3 9l5.4-1.6L10 2Zm5.5 11 .6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6.6-1.9Z'
  },
  {
    id: 'sunset-leak',
    category: 'atmosphere',
    labelZh: '落日漏光',
    labelEn: 'Light Leak',
    descZh: '胶片边缘暖橙绯红炫光漏光叠加',
    descEn: 'Warm amber and crimson film edge light leak',
    badge: 'LEAK',
    accent: '#fb7185',
    previewGradient: 'linear-gradient(125deg, #ff6b6b 0%, #feca57 45%, #1e293b 100%)',
    iconPath: 'M3 4h14v12H3V4Zm0 8c4-1 7-4 8-8m-8 11c6-1 10-5 12-11'
  },
  {
    id: 'neon-halo',
    category: 'atmosphere',
    labelZh: '霓虹光晕',
    labelEn: 'Neon Halo',
    descZh: '双色冷暖呼吸光晕环绕舞台四周',
    descEn: 'Breathing cyan-magenta halo around frame edges',
    badge: 'HALO',
    accent: '#38bdf8',
    previewGradient: 'radial-gradient(circle at 50% 50%, #0f172a 25%, #0284c7 68%, #ec4899 100%)',
    iconPath: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z'
  },
  {
    id: 'blur-focus',
    category: 'atmosphere',
    labelZh: '虚焦渐入',
    labelEn: 'Blur Focus',
    descZh: '镜头开场虚化追焦至清晰定格',
    descEn: 'Rack focus from soft blur into crisp clarity',
    badge: 'FOCUS',
    accent: '#38bdf8',
    previewGradient: 'linear-gradient(135deg, #0c4a6e 0%, #0284c7 55%, #bae6fd 100%)',
    iconPath: 'M4 7V4h3m9 3V4h-3M4 13v3h3m9-3v3h-3M10 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z'
  },
  {
    id: 'tilt-shift',
    category: 'atmosphere',
    labelZh: '移轴微缩',
    labelEn: 'Tilt-Shift',
    descZh: '上下景深柔化、中心清晰微缩模型质感',
    descEn: 'Top and bottom depth-of-field blur for miniature look',
    badge: 'TILT',
    accent: '#60a5fa',
    previewGradient: 'linear-gradient(180deg, #94a3b8 0%, #0f172a 35%, #0f172a 65%, #94a3b8 100%)',
    iconPath: 'M2.5 5.5h15M2.5 14.5h15M5 10h10'
  },
  {
    id: 'vhs-retro',
    category: 'retro',
    labelZh: '复古录像带',
    labelEn: 'VHS Retro',
    descZh: '90年代磁带扫描线、色度偏移与噪点质感',
    descEn: '90s VHS scanlines, chroma bleed and tape grain',
    badge: 'VHS',
    accent: '#22d3ee',
    previewGradient: 'linear-gradient(135deg, #164e63 0%, #06b6d4 50%, #f43f5e 100%)',
    iconPath: 'M2.5 5h15v10h-15V5Zm4 5a1.6 1.6 0 1 0 0 .01Zm7 0a1.6 1.6 0 1 0 0 .01ZM6.5 12h7'
  },
  {
    id: 'old-film',
    category: 'retro',
    labelZh: '老电影胶片',
    labelEn: '8mm Film',
    descZh: '复古泛黄银盐颗粒、柔和暗角与胶片闪烁',
    descEn: 'Vintage sepia silver grain, vignette and flicker',
    badge: '8MM',
    accent: '#d97706',
    previewGradient: 'linear-gradient(135deg, #292524 0%, #78350f 55%, #fcd34d 100%)',
    iconPath: 'M3 4h14v12H3V4Zm3 0v12m8-12v12M3 7h3m8 0h3M3 10h3m8 0h3M3 13h3m8 0h3'
  },
  {
    id: 'dv-cam',
    category: 'retro',
    labelZh: '千禧 DV 框',
    labelEn: 'Y2K DV Cam',
    descZh: '千禧年手持 DV 取景器准星框与 REC 录制标识',
    descEn: 'Y2K camcorder viewfinder frame with REC indicator',
    badge: 'REC',
    accent: '#ef4444',
    previewGradient: 'linear-gradient(135deg, #1e293b 0%, #334155 60%, #ef4444 100%)',
    iconPath:
      'M3 6V4h3m11 2V4h-3M3 14v2h3m11-2v2h-3M7 7.5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4ZM10 8.5v3M8.5 10h3'
  },
  {
    id: 'posterize-pop',
    category: 'retro',
    labelZh: '波普艺术',
    labelEn: 'Pop Art',
    descZh: '安迪·沃霍尔式超高饱和对比波普漫画色彩',
    descEn: 'Warhol-inspired hyper-saturated high-contrast pop art',
    badge: 'POP',
    accent: '#f43f5e',
    previewGradient: 'linear-gradient(135deg, #f43f5e 0%, #facc15 50%, #3b82f6 100%)',
    iconPath:
      'M10 2.5a7.5 7.5 0 1 0 7.5 7.5c0-1.5-1.2-2.5-2.8-2.5h-1.7a2 2 0 0 1-2-2V3.8c0-.7-.4-1.3-1-1.3Z'
  },
  {
    id: 'negative-invert',
    category: 'retro',
    labelZh: '胶片负片',
    labelEn: 'Negative Invert',
    descZh: '反转色彩通道呈现实验视觉冲击',
    descEn: 'Inverted color channels for experimental impact',
    badge: 'INV',
    accent: '#818cf8',
    previewGradient: 'linear-gradient(135deg, #312e81 0%, #6366f1 50%, #2dd4bf 100%)',
    iconPath: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 0v14'
  },
  {
    id: 'cinema-letterbox',
    category: 'cinema',
    labelZh: '宽银幕黑边',
    labelEn: '2.35:1 Scope',
    descZh: '电影院 2.35:1 宽银幕上下遮幅与电影反差',
    descEn: 'Anamorphic 2.35:1 cinema letterbox bars and contrast',
    badge: '2.35:1',
    accent: '#94a3b8',
    previewGradient:
      'linear-gradient(180deg, #020617 0%, #020617 18%, #334155 50%, #020617 82%, #020617 100%)',
    iconPath: 'M2.5 4h15v12h-15V4Zm0 2.5h15m-15 7h15'
  },
  {
    id: 'bw-spotlight',
    category: 'cinema',
    labelZh: '黑白聚光',
    labelEn: 'Noir Spotlight',
    descZh: '高反差黑白纪实影调与深邃四周暗角',
    descEn: 'High-contrast monochrome with deep spotlight vignette',
    badge: 'NOIR',
    accent: '#cbd5e1',
    previewGradient: 'radial-gradient(circle at 50% 50%, #f8fafc 0%, #475569 52%, #020617 100%)',
    iconPath: 'M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm0 2.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z'
  },
  {
    id: 'thermal-vision',
    category: 'cinema',
    labelZh: '热成像仪',
    labelEn: 'Thermal Vision',
    descZh: '红外热成像是紫蓝-亮橙高反差伪彩视觉',
    descEn: 'Infrared thermal false-color purple-orange vision',
    badge: 'HEAT',
    accent: '#f97316',
    previewGradient: 'linear-gradient(135deg, #1e1b4b 0%, #9333ea 38%, #f97316 74%, #fef08a 100%)',
    iconPath: 'M10 3v9.5a2.5 2.5 0 1 1-2 0V3a1 1 0 0 1 2 0Zm3.5 2h2m-2 3h1.5m-1.5 3h2'
  },
  {
    id: 'night-vision',
    category: 'cinema',
    labelZh: '夜视绿光',
    labelEn: 'Night Vision',
    descZh: '战术夜视仪荧光绿单色强化、噪点与暗角',
    descEn: 'Tactical phosphor green night-vision with grain & vignette',
    badge: 'NVG',
    accent: '#22c55e',
    previewGradient: 'radial-gradient(circle at 50% 50%, #4ade80 0%, #15803d 55%, #052e16 100%)',
    iconPath:
      'M2.5 10s3-5 7.5-5 7.5 5 7.5 5-3 5-7.5 5-7.5-5-7.5-5Zm7.5-2.2a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4Z'
  },
  {
    id: 'split-2h',
    category: 'split',
    labelZh: '左右双分屏',
    labelEn: 'Twin Split',
    descZh: '经典左右对称双格分屏美学构图线',
    descEn: 'Symmetric left-right twin split-screen frame',
    badge: '2-SPLIT',
    accent: '#38bdf8',
    previewGradient:
      'linear-gradient(90deg, #0284c7 0%, #0369a1 49%, #f8fafc 50%, #0369a1 51%, #0284c7 100%)',
    iconPath: 'M3 4h14v12H3V4Zm7 0v12'
  },
  {
    id: 'split-3v',
    category: 'split',
    labelZh: '三格漫画屏',
    labelEn: 'Triple Panel',
    descZh: '电影感三联分屏分割线与暗部强调',
    descEn: 'Triptych 3-panel cinema split-screen frame',
    badge: '3-SPLIT',
    accent: '#818cf8',
    previewGradient:
      'linear-gradient(90deg, #312e81 0%, #4f46e5 32%, #f8fafc 33%, #4f46e5 34%, #4f46e5 65%, #f8fafc 66%, #312e81 100%)',
    iconPath: 'M2.5 4h15v12h-15V4Zm5 0v12m5-12v12'
  },
  {
    id: 'split-4grid',
    category: 'split',
    labelZh: '四宫格分屏',
    labelEn: 'Quad Grid',
    descZh: '2×2 四宫格十字分割线与现代节奏感',
    descEn: '2x2 quad grid split-screen overlay',
    badge: '4-GRID',
    accent: '#c084fc',
    previewGradient: 'linear-gradient(135deg, #4c1d95 0%, #7c3aed 48%, #c084fc 100%)',
    iconPath: 'M3 4h14v12H3V4Zm7 0v12M3 10h14'
  }
] as const

export type TimelineTransitionCategory = 'all' | 'basic' | 'slide' | 'wipe' | 'split' | 'fx'

export interface TimelineTransitionCatalogItem {
  id: Exclude<ScriptTimelineTransitionType, 'none'>
  category: Exclude<TimelineTransitionCategory, 'all'>
  labelZh: string
  labelEn: string
  descZh: string
  descEn: string
  defaultDurationSec: number
  badge: string
  accent: string
  iconPath: string
}

export const TIMELINE_TRANSITION_CATEGORIES: readonly {
  id: TimelineTransitionCategory
  labelZh: string
  labelEn: string
  iconPath: string
}[] = [
  {
    id: 'all',
    labelZh: '全部',
    labelEn: 'All',
    iconPath:
      'M3.5 3.5h5.2v5.2H3.5V3.5Zm7.8 0h5.2v5.2h-5.2V3.5ZM3.5 11.3h5.2v5.2H3.5v-5.2Zm7.8 0h5.2v5.2h-5.2v-5.2Z'
  },
  {
    id: 'basic',
    labelZh: '基础叠化',
    labelEn: 'Basic',
    iconPath: 'M7.5 10a4.5 4.5 0 1 0 0 .01Zm5 0a4.5 4.5 0 1 0 0 .01Z'
  },
  {
    id: 'slide',
    labelZh: '运镜推拉',
    labelEn: 'Slide',
    iconPath: 'M4 10h12m0 0-4-4m4 4-4 4'
  },
  {
    id: 'wipe',
    labelZh: '线性擦除',
    labelEn: 'Wipe',
    iconPath: 'M3 4h14v12H3V4Zm7 0v12m2-8 2.5 2-2.5 2'
  },
  {
    id: 'split',
    labelZh: '分割百叶',
    labelEn: 'Split & Blinds',
    iconPath: 'M3 4h14v12H3V4Zm4.5 0v12m5-12v12'
  },
  {
    id: 'fx',
    labelZh: '图形特效',
    labelEn: 'Shape FX',
    iconPath: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 3.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z'
  }
] as const

export const TIMELINE_TRANSITION_CATALOG: readonly TimelineTransitionCatalogItem[] = [
  {
    id: 'dissolve',
    category: 'basic',
    labelZh: '柔和叠化',
    labelEn: 'Cross Dissolve',
    descZh: '前后镜头平滑交叉溶入，适合绝大多数叙事切点',
    descEn: 'Smooth cross dissolve between adjacent shots',
    defaultDurationSec: 0.45,
    badge: 'MIX',
    accent: '#38bdf8',
    iconPath: 'M7.5 10a4.2 4.2 0 1 0 0 .01Zm5 0a4.2 4.2 0 1 0 0 .01Z'
  },
  {
    id: 'fade',
    category: 'basic',
    labelZh: '暗场渐隐',
    labelEn: 'Dip to Black',
    descZh: '经黑场呼吸过渡，适合时空转换与章节停顿',
    descEn: 'Dip to black fade for scene and time transitions',
    defaultDurationSec: 0.5,
    badge: 'DARK',
    accent: '#60a5fa',
    iconPath: 'M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 0v13'
  },
  {
    id: 'flash',
    category: 'basic',
    labelZh: '闪白卡点',
    labelEn: 'White Flash',
    descZh: '高能强光闪白切镜，适合快剪、回忆与重拍卡点',
    descEn: 'Bright flash cut for beat drops and flashbacks',
    defaultDurationSec: 0.35,
    badge: 'FLASH',
    accent: '#facc15',
    iconPath: 'M11 2.5 4.8 10.5h4.8l-1 7L15.2 9.5h-4.8l0.6-7Z'
  },
  {
    id: 'fadegrays',
    category: 'basic',
    labelZh: '褪色灰影',
    labelEn: 'Fade Grays',
    descZh: '先抽离色彩转为黑白纪实再溶入下一镜头',
    descEn: 'Desaturate through monochrome grayscale into next clip',
    defaultDurationSec: 0.5,
    badge: 'GRAY',
    accent: '#94a3b8',
    iconPath: 'M3.5 5h13v10h-13V5Zm4.5 0v10m4-10v10'
  },
  {
    id: 'hblur',
    category: 'basic',
    labelZh: '丝滑柔焦',
    labelEn: 'Motion Blur',
    descZh: '横向高速运动模糊衔接前后镜头',
    descEn: 'Horizontal motion blur dissolve',
    defaultDurationSec: 0.45,
    badge: 'BLUR',
    accent: '#818cf8',
    iconPath: 'M3 6.5h11M6 10h11M4 13.5h10'
  },
  {
    id: 'distance',
    category: 'basic',
    labelZh: '色差渐溶',
    labelEn: 'Chroma Melt',
    descZh: '基于色度距离的梦幻光影消融过渡',
    descEn: 'Color-distance luminance dissolve transition',
    defaultDurationSec: 0.5,
    badge: 'MELT',
    accent: '#c084fc',
    iconPath: 'M10 3 12 8l5 2-5 2-2 5-2-5-5-2 5-2 2-5Z'
  },
  {
    id: 'smoothleft',
    category: 'slide',
    labelZh: '丝滑左甩',
    labelEn: 'Whip Left',
    descZh: '带运动惯性的向左丝滑甩镜过渡',
    descEn: 'Smooth whip pan to the left',
    defaultDurationSec: 0.4,
    badge: 'PAN←',
    accent: '#34d399',
    iconPath: 'M16 10H4m0 0 4-4m-4 4 4 4'
  },
  {
    id: 'smoothright',
    category: 'slide',
    labelZh: '丝滑右甩',
    labelEn: 'Whip Right',
    descZh: '带运动惯性的向右丝滑甩镜过渡',
    descEn: 'Smooth whip pan to the right',
    defaultDurationSec: 0.4,
    badge: 'PAN→',
    accent: '#34d399',
    iconPath: 'M4 10h12m0 0-4-4m4 4-4 4'
  },
  {
    id: 'smoothup',
    category: 'slide',
    labelZh: '丝滑上甩',
    labelEn: 'Whip Up',
    descZh: '带运动惯性的向上丝滑甩镜过渡',
    descEn: 'Smooth whip tilt upward',
    defaultDurationSec: 0.4,
    badge: 'PAN↑',
    accent: '#2dd4bf',
    iconPath: 'M10 16V4m0 0-4 4m4-4 4 4'
  },
  {
    id: 'smoothdown',
    category: 'slide',
    labelZh: '丝滑下甩',
    labelEn: 'Whip Down',
    descZh: '带运动惯性的向下丝滑甩镜过渡',
    descEn: 'Smooth whip tilt downward',
    defaultDurationSec: 0.4,
    badge: 'PAN↓',
    accent: '#2dd4bf',
    iconPath: 'M10 4v12m0 0-4-4m4 4 4-4'
  },
  {
    id: 'slideleft',
    category: 'slide',
    labelZh: '向左推镜',
    labelEn: 'Push Left',
    descZh: '新画面从右侧平推入场顶出旧画面',
    descEn: 'Push incoming shot from right to left',
    defaultDurationSec: 0.4,
    badge: 'SLIDE←',
    accent: '#10b981',
    iconPath: 'M13 5v10M16.5 10h-9m0 0 3-3m-3 3 3 3'
  },
  {
    id: 'slideright',
    category: 'slide',
    labelZh: '向右推镜',
    labelEn: 'Push Right',
    descZh: '新画面从左侧平推入场顶出旧画面',
    descEn: 'Push incoming shot from left to right',
    defaultDurationSec: 0.4,
    badge: 'SLIDE→',
    accent: '#10b981',
    iconPath: 'M7 5v10M3.5 10h9m0 0-3-3m3 3-3 3'
  },
  {
    id: 'slideup',
    category: 'slide',
    labelZh: '向上推镜',
    labelEn: 'Push Up',
    descZh: '新画面从底部向上平推入场',
    descEn: 'Push incoming shot from bottom to top',
    defaultDurationSec: 0.4,
    badge: 'SLIDE↑',
    accent: '#14b8a6',
    iconPath: 'M5 13h10M10 16.5v-9m0 0-3 3m3-3 3 3'
  },
  {
    id: 'slidedown',
    category: 'slide',
    labelZh: '向下推镜',
    labelEn: 'Push Down',
    descZh: '新画面从顶部向下平推入场',
    descEn: 'Push incoming shot from top to bottom',
    defaultDurationSec: 0.4,
    badge: 'SLIDE↓',
    accent: '#14b8a6',
    iconPath: 'M5 7h10M10 3.5v9m0 0-3-3m3 3 3-3'
  },
  {
    id: 'wipeleft',
    category: 'wipe',
    labelZh: '向左擦除',
    labelEn: 'Wipe Left',
    descZh: '切线自右向左扫过揭示下一镜',
    descEn: 'Linear wipe revealing next shot from right to left',
    defaultDurationSec: 0.45,
    badge: 'WIPE←',
    accent: '#f59e0b',
    iconPath: 'M3 4h14v12H3V4Zm7 0v12m-2-6-2.5-2m2.5 2-2.5 2'
  },
  {
    id: 'wiperight',
    category: 'wipe',
    labelZh: '向右擦除',
    labelEn: 'Wipe Right',
    descZh: '切线自左向右扫过揭示下一镜',
    descEn: 'Linear wipe revealing next shot from left to right',
    defaultDurationSec: 0.45,
    badge: 'WIPE→',
    accent: '#f59e0b',
    iconPath: 'M3 4h14v12H3V4Zm7 0v12m2-6 2.5-2m-2.5 2 2.5 2'
  },
  {
    id: 'wipeup',
    category: 'wipe',
    labelZh: '向上擦除',
    labelEn: 'Wipe Up',
    descZh: '切线自下向上扫过揭示下一镜',
    descEn: 'Linear wipe from bottom to top',
    defaultDurationSec: 0.45,
    badge: 'WIPE↑',
    accent: '#fb923c',
    iconPath: 'M3 4h14v12H3V4Zm0 6h14m-7-2-2-2m2 2 2-2'
  },
  {
    id: 'wipedown',
    category: 'wipe',
    labelZh: '向下擦除',
    labelEn: 'Wipe Down',
    descZh: '切线自上向下扫过揭示下一镜',
    descEn: 'Linear wipe from top to bottom',
    defaultDurationSec: 0.45,
    badge: 'WIPE↓',
    accent: '#fb923c',
    iconPath: 'M3 4h14v12H3V4Zm0 6h14m-7 2-2 2m2-2 2 2'
  },
  {
    id: 'wipetl',
    category: 'wipe',
    labelZh: '左上斜擦',
    labelEn: 'Wipe Top-Left',
    descZh: '对角切线向左上角斜向擦除',
    descEn: 'Diagonal wipe toward top-left corner',
    defaultDurationSec: 0.45,
    badge: 'WIPE↖',
    accent: '#f97316',
    iconPath: 'M3 4h14v12H3V4Zm14 0L3 16M9 9 6 6m0 0h2.5M6 6v2.5'
  },
  {
    id: 'wipetr',
    category: 'wipe',
    labelZh: '右上斜擦',
    labelEn: 'Wipe Top-Right',
    descZh: '对角切线向右上角斜向擦除',
    descEn: 'Diagonal wipe toward top-right corner',
    defaultDurationSec: 0.45,
    badge: 'WIPE↗',
    accent: '#f97316',
    iconPath: 'M3 4h14v12H3V4Zm0 0 14 12M11 9l3-3m0 0h-2.5M14 6v2.5'
  },
  {
    id: 'wipebl',
    category: 'wipe',
    labelZh: '左下斜擦',
    labelEn: 'Wipe Bot-Left',
    descZh: '对角切线向左下角斜向擦除',
    descEn: 'Diagonal wipe toward bottom-left corner',
    defaultDurationSec: 0.45,
    badge: 'WIPE↙',
    accent: '#ea580c',
    iconPath: 'M3 4h14v12H3V4Zm0 0 14 12M9 11l-3 3m0 0h2.5M6 14v-2.5'
  },
  {
    id: 'wipebr',
    category: 'wipe',
    labelZh: '右下斜擦',
    labelEn: 'Wipe Bot-Right',
    descZh: '对角切线向右下角斜向擦除',
    descEn: 'Diagonal wipe toward bottom-right corner',
    defaultDurationSec: 0.45,
    badge: 'WIPE↘',
    accent: '#ea580c',
    iconPath: 'M3 4h14v12H3V4Zm14 0L3 16m8-5 3 3m0 0h-2.5m2.5 0v-2.5'
  },
  {
    id: 'horzopen',
    category: 'split',
    labelZh: '水平帷幕',
    labelEn: 'Horiz Open',
    descZh: '从中轴向左右两侧拉开帷幕',
    descEn: 'Split open horizontally from center',
    defaultDurationSec: 0.5,
    badge: 'H-OPEN',
    accent: '#38bdf8',
    iconPath: 'M10 4v12M7.5 10H4m0 0 2-2m-2 2 2 2m6.5-2H16m0 0-2-2m2 2-2 2'
  },
  {
    id: 'horzclose',
    category: 'split',
    labelZh: '水平合拢',
    labelEn: 'Horiz Close',
    descZh: '从左右两侧向中心合拢切换',
    descEn: 'Close horizontally from edges to center',
    defaultDurationSec: 0.5,
    badge: 'H-CLS',
    accent: '#38bdf8',
    iconPath: 'M10 4v12M3.5 10H7m0 0-2-2m2 2-2 2m9.5-2H13m0 0 2-2m-2 2 2 2'
  },
  {
    id: 'vertopen',
    category: 'split',
    labelZh: '垂直帷幕',
    labelEn: 'Vert Open',
    descZh: '从中轴向上下两侧拉开宽银幕',
    descEn: 'Split open vertically from center',
    defaultDurationSec: 0.5,
    badge: 'V-OPEN',
    accent: '#60a5fa',
    iconPath: 'M4 10h12M10 7.5V4m0 0-2 2m2-2 2 2m-2 6.5V16m0 0-2-2m2 2 2-2'
  },
  {
    id: 'vertclose',
    category: 'split',
    labelZh: '垂直合拢',
    labelEn: 'Vert Close',
    descZh: '从上下两端向中轴合拢闭合',
    descEn: 'Close vertically toward center line',
    defaultDurationSec: 0.5,
    badge: 'V-CLS',
    accent: '#60a5fa',
    iconPath: 'M4 10h12M10 3.5V7m0 0-2-2m2 2 2-2m-2 9.5V13m0 0-2 2m2-2 2 2'
  },
  {
    id: 'hlslice',
    category: 'split',
    labelZh: '左向百叶窗',
    labelEn: 'Blinds Left',
    descZh: '多条纵向百叶切片向左翻开',
    descEn: 'Multi-strip vertical blinds slicing left',
    defaultDurationSec: 0.45,
    badge: 'SLICE←',
    accent: '#818cf8',
    iconPath: 'M4 4v12M8 4v12M12 4v12M16 4v12'
  },
  {
    id: 'hrslice',
    category: 'split',
    labelZh: '右向百叶窗',
    labelEn: 'Blinds Right',
    descZh: '多条纵向百叶切片向右翻开',
    descEn: 'Multi-strip vertical blinds slicing right',
    defaultDurationSec: 0.45,
    badge: 'SLICE→',
    accent: '#818cf8',
    iconPath: 'M4 4v12M8 4v12M12 4v12M16 4v12M5 10h2m4 0h2'
  },
  {
    id: 'vuslice',
    category: 'split',
    labelZh: '上向百叶窗',
    labelEn: 'Blinds Up',
    descZh: '多条横向百叶切片向上翻开',
    descEn: 'Horizontal blinds slicing upward',
    defaultDurationSec: 0.45,
    badge: 'SLICE↑',
    accent: '#a78bfa',
    iconPath: 'M3 5h14M3 8.5h14M3 12h14M3 15.5h14'
  },
  {
    id: 'vdslice',
    category: 'split',
    labelZh: '下向百叶窗',
    labelEn: 'Blinds Down',
    descZh: '多条横向百叶切片向下翻开',
    descEn: 'Horizontal blinds slicing downward',
    defaultDurationSec: 0.45,
    badge: 'SLICE↓',
    accent: '#a78bfa',
    iconPath: 'M3 4.5h14M3 8h14M3 11.5h14M3 15h14'
  },
  {
    id: 'zoomin',
    category: 'fx',
    labelZh: '穿梭推进',
    labelEn: 'Zoom Through',
    descZh: '急推放大穿越至下一镜头',
    descEn: 'Fast zoom-in transition into next clip',
    defaultDurationSec: 0.4,
    badge: 'ZOOM',
    accent: '#ec4899',
    iconPath: 'M4 4l4 4m8-4-4 4M4 16l4-4m8 4-4-4'
  },
  {
    id: 'circleopen',
    category: 'fx',
    labelZh: '瞳孔展开',
    labelEn: 'Iris Open',
    descZh: '圆形光圈从画面中心向外扩散',
    descEn: 'Circular iris expanding from center',
    defaultDurationSec: 0.5,
    badge: 'IRIS+',
    accent: '#a855f7',
    iconPath:
      'M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 4a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z'
  },
  {
    id: 'circleclose',
    category: 'fx',
    labelZh: '瞳孔收缩',
    labelEn: 'Iris Close',
    descZh: '圆形光圈向中心收拢切换',
    descEn: 'Circular iris closing toward center',
    defaultDurationSec: 0.5,
    badge: 'IRIS-',
    accent: '#a855f7',
    iconPath: 'M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 4.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z'
  },
  {
    id: 'rectcrop',
    category: 'fx',
    labelZh: '矩框展开',
    labelEn: 'Box Reveal',
    descZh: '矩形画框从中心对称扩张揭示新画面',
    descEn: 'Rectangular frame expanding from center',
    defaultDurationSec: 0.45,
    badge: 'RECT',
    accent: '#c084fc',
    iconPath: 'M3 4h14v12H3V4Zm4 3h6v6H7V7Z'
  },
  {
    id: 'radial',
    category: 'fx',
    labelZh: '钟表扫描',
    labelEn: 'Radial Clock',
    descZh: '顺时针扇形雷达扫描切换画面',
    descEn: 'Clockwise radial sweep transition',
    defaultDurationSec: 0.55,
    badge: 'RADIAL',
    accent: '#8b5cf6',
    iconPath: 'M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 0V10l4.5 2.5'
  },
  {
    id: 'pixelize',
    category: 'fx',
    labelZh: '像素重构',
    labelEn: 'Pixelize',
    descZh: '数字马赛克像素化过渡，适合科幻与游戏题材',
    descEn: 'Digital mosaic pixelization transition',
    defaultDurationSec: 0.45,
    badge: 'PIXEL',
    accent: '#ec4899',
    iconPath: 'M4 4h4v4H4V4Zm4 4h4v4H8V8Zm4-4h4v4h-4V4ZM4 12h4v4H4v-4Zm8 0h4v4h-4v-4Z'
  },
  {
    id: 'squeezeh',
    category: 'fx',
    labelZh: '水平挤压',
    labelEn: 'Squeeze H',
    descZh: '旧画面横向压缩折叠揭示新镜头',
    descEn: 'Horizontal squeeze fold transition',
    defaultDurationSec: 0.45,
    badge: 'SQZ-H',
    accent: '#f43f5e',
    iconPath: 'M3 5v10M17 5v10M6 10h8m-8 0 2-2m-2 2 2 2m6-2-2-2m2 2-2 2'
  },
  {
    id: 'squeezev',
    category: 'fx',
    labelZh: '垂直挤压',
    labelEn: 'Squeeze V',
    descZh: '旧画面纵向压缩折叠揭示新镜头',
    descEn: 'Vertical squeeze fold transition',
    defaultDurationSec: 0.45,
    badge: 'SQZ-V',
    accent: '#f43f5e',
    iconPath: 'M5 3h10M5 17h10M10 6v8m0-8-2 2m2-2 2 2m-2 6-2-2m2 2 2-2'
  },
  {
    id: 'diagtl',
    category: 'fx',
    labelZh: '对角左上切',
    labelEn: 'Diagonal TL',
    descZh: '斜向对角折页向左上展开',
    descEn: 'Diagonal iris sweep toward top-left',
    defaultDurationSec: 0.45,
    badge: 'DIAG↖',
    accent: '#fb7185',
    iconPath: 'M3 4h14v12H3V4Zm0 12L17 4'
  },
  {
    id: 'diagbr',
    category: 'fx',
    labelZh: '对角右下切',
    labelEn: 'Diagonal BR',
    descZh: '斜向对角折页向右下展开',
    descEn: 'Diagonal iris sweep toward bottom-right',
    defaultDurationSec: 0.45,
    badge: 'DIAG↘',
    accent: '#fb7185',
    iconPath: 'M3 4h14v12H3V4Zm0 0 14 12'
  }
] as const

export type TimelineFilterCategory = 'all' | 'cinema' | 'film' | 'portrait' | 'nature' | 'style'

export interface TimelineFilterPresetMeta {
  id: TimelineFilterPresetId
  category: Exclude<TimelineFilterCategory, 'all'>
  labelZh: string
  labelEn: string
  descZh: string
  descEn: string
  badge: string
  accent: string
  previewGradient: string
  iconPath: string
  /** 预设内部调色参数 */
  recipe: {
    brightness: number
    contrast: number
    saturation: number
    sepia: number
    hueRotateDeg: number
    temperature: number
    tint: number
    vignette: number
    fade: number
    /** FFmpeg colorbalance 参数 */
    colorBalance?: {
      rs?: number
      gs?: number
      bs?: number
      rm?: number
      gm?: number
      bm?: number
      rh?: number
      gh?: number
      bh?: number
    }
  }
}

export const TIMELINE_FILTER_CATEGORIES: readonly {
  id: TimelineFilterCategory
  labelZh: string
  labelEn: string
  iconPath: string
}[] = [
  {
    id: 'all',
    labelZh: '全部',
    labelEn: 'All',
    iconPath:
      'M3.5 3.5h5.2v5.2H3.5V3.5Zm7.8 0h5.2v5.2h-5.2V3.5ZM3.5 11.3h5.2v5.2H3.5v-5.2Zm7.8 0h5.2v5.2h-5.2v-5.2Z'
  },
  {
    id: 'cinema',
    labelZh: '电影大片',
    labelEn: 'Cinema',
    iconPath: 'M2.5 4.5h15v11h-15v-11ZM2.5 7.2h15M2.5 12.8h15'
  },
  {
    id: 'film',
    labelZh: '复古胶片',
    labelEn: 'Film',
    iconPath: 'M3 4h14v12H3V4Zm3 0v12m8-12v12'
  },
  {
    id: 'portrait',
    labelZh: '人像清透',
    labelEn: 'Portrait',
    iconPath: 'M10 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5.5 6.5a5.5 5.5 0 0 1 11 0'
  },
  {
    id: 'nature',
    labelZh: '自然风光',
    labelEn: 'Nature',
    iconPath: 'M3 15.5 8 8.5l4 5 2.5-3.5 3 5.5H3ZM14.5 6.5a1.8 1.8 0 1 0 0 .01Z'
  },
  {
    id: 'style',
    labelZh: '潮酷风格',
    labelEn: 'Style',
    iconPath: 'M8 8.2a4.2 4.2 0 1 0 0 .01Zm4.2 0a4.2 4.2 0 1 0 0 .01Zm-2.1 3.8a4.2 4.2 0 1 0 0 .01Z'
  }
] as const

export const TIMELINE_FILTER_PRESETS: readonly TimelineFilterPresetMeta[] = [
  {
    id: 'none',
    category: 'cinema',
    labelZh: '原片直出',
    labelEn: 'Original',
    descZh: '不应用预设滤镜，保留原始色彩',
    descEn: 'Original colors without LUT filter',
    badge: 'RAW',
    accent: '#64748b',
    previewGradient: 'linear-gradient(135deg, #334155 0%, #64748b 100%)',
    iconPath: 'M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM5.4 5.4l9.2 9.2',
    recipe: {
      brightness: 0,
      contrast: 1,
      saturation: 1,
      sepia: 0,
      hueRotateDeg: 0,
      temperature: 0,
      tint: 0,
      vignette: 0,
      fade: 0
    }
  },
  {
    id: 'black-gold',
    category: 'cinema',
    labelZh: '黑金都市',
    labelEn: 'Black Gold',
    descZh: '压暗冷调阴影、提亮暖金高光，适合夜景与商业大片',
    descEn: 'Deep obsidian shadows with rich golden highlights',
    badge: 'GOLD',
    accent: '#f59e0b',
    previewGradient: 'linear-gradient(135deg, #090d16 0%, #27272a 48%, #f59e0b 100%)',
    iconPath: 'M4 15.5V7l4 3V5l4 4V4l4 3.5v8H4Z',
    recipe: {
      brightness: -0.04,
      contrast: 1.26,
      saturation: 0.82,
      sepia: 0.22,
      hueRotateDeg: -6,
      temperature: 18,
      tint: -4,
      vignette: 28,
      fade: 0,
      colorBalance: {
        rs: -0.06,
        gs: -0.05,
        bs: -0.02,
        rm: 0.08,
        gm: 0.03,
        bm: -0.12,
        rh: 0.16,
        gh: 0.08,
        bh: -0.18
      }
    }
  },
  {
    id: 'teal-orange',
    category: 'cinema',
    labelZh: '青橙大片',
    labelEn: 'Teal & Orange',
    descZh: '好莱坞经典冷青暗部与暖橙肤色高反差互补调色',
    descEn: 'Hollywood blockbuster teal shadows and warm orange highlights',
    badge: 'T&O',
    accent: '#06b6d4',
    previewGradient: 'linear-gradient(135deg, #083344 0%, #0e7490 48%, #f97316 100%)',
    iconPath: 'M2.5 5h15v10h-15V5Zm7.5 0v10',
    recipe: {
      brightness: 0,
      contrast: 1.18,
      saturation: 1.22,
      sepia: 0.08,
      hueRotateDeg: -8,
      temperature: 10,
      tint: -6,
      vignette: 18,
      fade: 0,
      colorBalance: {
        rs: -0.14,
        gs: 0.04,
        bs: 0.16,
        rm: 0.04,
        gm: 0,
        bm: -0.04,
        rh: 0.18,
        gh: 0.06,
        bh: -0.16
      }
    }
  },
  {
    id: 'cyberpunk',
    category: 'cinema',
    labelZh: '赛博霓虹',
    labelEn: 'Cyberpunk',
    descZh: '高饱和洋红与电光青蓝碰撞，适合科幻与都市夜色',
    descEn: 'Electric cyan and neon magenta sci-fi grading',
    badge: 'CYBER',
    accent: '#ec4899',
    previewGradient: 'linear-gradient(135deg, #0f172a 0%, #9333ea 50%, #06b6d4 100%)',
    iconPath: 'M11 2.5 4.8 10.5h4.8l-1 7L15.2 9.5h-4.8l0.6-7Z',
    recipe: {
      brightness: 0.02,
      contrast: 1.24,
      saturation: 1.38,
      sepia: 0,
      hueRotateDeg: -14,
      temperature: -22,
      tint: 26,
      vignette: 22,
      fade: 0,
      colorBalance: {
        rs: -0.1,
        gs: -0.08,
        bs: 0.22,
        rm: 0.12,
        gm: -0.1,
        bm: 0.2,
        rh: -0.06,
        gh: 0.12,
        bh: 0.22
      }
    }
  },
  {
    id: 'blade-runner',
    category: 'cinema',
    labelZh: '银翼迷雾',
    labelEn: 'Blade Runner',
    descZh: '赛博废土深青迷雾与琥珀钠灯冷暖对撞',
    descEn: 'Dystopian deep cyan haze and sodium amber streetlamp glow',
    badge: '2049',
    accent: '#0891b2',
    previewGradient: 'linear-gradient(135deg, #042f2e 0%, #0e7490 50%, #d97706 100%)',
    iconPath: 'M3 7h14M5 10.5h10M7 14h6',
    recipe: {
      brightness: -0.02,
      contrast: 1.22,
      saturation: 1.15,
      sepia: 0.12,
      hueRotateDeg: -6,
      temperature: -8,
      tint: -14,
      vignette: 26,
      fade: 8,
      colorBalance: {
        rs: -0.12,
        gs: 0.06,
        bs: 0.14,
        rm: 0.08,
        gm: 0.02,
        bm: -0.08,
        rh: 0.16,
        gh: 0.08,
        bh: -0.12
      }
    }
  },
  {
    id: 'dune-sand',
    category: 'cinema',
    labelZh: '沙丘荒漠',
    labelEn: 'Dune Amber',
    descZh: '维伦纽瓦式低饱和暖金沙暴史诗影调',
    descEn: 'Villeneuve-style desaturated golden desert epic LUT',
    badge: 'DUNE',
    accent: '#d97706',
    previewGradient: 'linear-gradient(135deg, #292524 0%, #a16207 52%, #fde68a 100%)',
    iconPath: 'M2.5 14c3-3 5.5-3 8.5 0s5 3 6.5 0M2.5 10c3-2.5 5.5-2.5 8.5 0',
    recipe: {
      brightness: 0.01,
      contrast: 1.18,
      saturation: 0.76,
      sepia: 0.34,
      hueRotateDeg: -4,
      temperature: 26,
      tint: -4,
      vignette: 22,
      fade: 10,
      colorBalance: {
        rs: 0.1,
        gs: 0.05,
        bs: -0.14,
        rm: 0.12,
        gm: 0.06,
        bm: -0.16,
        rh: 0.1,
        gh: 0.06,
        bh: -0.1
      }
    }
  },
  {
    id: 'matrix-green',
    category: 'cinema',
    labelZh: '黑客暗绿',
    labelEn: 'Matrix Tint',
    descZh: '冷峻翡翠绿中间调与深黑暗部科幻电影感',
    descEn: 'Emerald sci-fi midtones with crushed obsidian blacks',
    badge: 'CODE',
    accent: '#10b981',
    previewGradient: 'linear-gradient(135deg, #022c22 0%, #047857 55%, #a7f3d0 100%)',
    iconPath: 'M5 4v12M10 4v12M15 4v12',
    recipe: {
      brightness: -0.03,
      contrast: 1.26,
      saturation: 0.86,
      sepia: 0.08,
      hueRotateDeg: 28,
      temperature: -14,
      tint: -34,
      vignette: 26,
      fade: 4,
      colorBalance: {
        rs: -0.12,
        gs: 0.14,
        bs: -0.06,
        rm: -0.1,
        gm: 0.18,
        bm: -0.06,
        rh: -0.04,
        gh: 0.12,
        bh: -0.02
      }
    }
  },
  {
    id: 'noir-bw',
    category: 'cinema',
    labelZh: '高反差黑白',
    labelEn: 'Noir B&W',
    descZh: '抽离全部色彩，强化明暗戏剧张力与银盐质感',
    descEn: 'Dramatic high-contrast monochrome cinema look',
    badge: 'B&W',
    accent: '#94a3b8',
    previewGradient: 'linear-gradient(135deg, #020617 0%, #475569 52%, #f8fafc 100%)',
    iconPath: 'M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 0v13',
    recipe: {
      brightness: -0.02,
      contrast: 1.32,
      saturation: 0,
      sepia: 0,
      hueRotateDeg: 0,
      temperature: 0,
      tint: 0,
      vignette: 32,
      fade: 5
    }
  },
  {
    id: 'fuji-classic',
    category: 'film',
    labelZh: '富士胶片',
    labelEn: 'Fuji Classic',
    descZh: 'Classic Chrome 清透青绿暗部与柔和胶片反差',
    descEn: 'Fuji Classic Chrome muted greens and soft film roll-off',
    badge: 'FUJI',
    accent: '#10b981',
    previewGradient: 'linear-gradient(135deg, #064e3b 0%, #059669 50%, #fef3c7 100%)',
    iconPath:
      'M3.5 6h13v9h-13V6Zm3-2h7l1 2h-9l1-2Zm3.5 3.5a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z',
    recipe: {
      brightness: 0.02,
      contrast: 1.08,
      saturation: 0.92,
      sepia: 0.08,
      hueRotateDeg: 6,
      temperature: -8,
      tint: -12,
      vignette: 14,
      fade: 12,
      colorBalance: {
        rs: -0.06,
        gs: 0.06,
        bs: 0.04,
        rm: -0.02,
        gm: 0.04,
        bm: 0,
        rh: 0.06,
        gh: 0.04,
        bh: -0.04
      }
    }
  },
  {
    id: 'kodak-portra',
    category: 'film',
    labelZh: '柯达暖金',
    labelEn: 'Kodak Portra',
    descZh: 'Portra 400 温暖通透肤色与琥珀色胶片层次',
    descEn: 'Warm golden skin tones and creamy Portra 400 highlights',
    badge: 'KODAK',
    accent: '#f59e0b',
    previewGradient: 'linear-gradient(135deg, #451a03 0%, #d97706 52%, #fef08a 100%)',
    iconPath: 'M3 4h14v12H3V4Zm3 0v12m8-12v12',
    recipe: {
      brightness: 0.03,
      contrast: 1.08,
      saturation: 1.12,
      sepia: 0.16,
      hueRotateDeg: -4,
      temperature: 22,
      tint: 4,
      vignette: 12,
      fade: 8,
      colorBalance: {
        rs: 0.06,
        gs: 0.02,
        bs: -0.08,
        rm: 0.1,
        gm: 0.04,
        bm: -0.08,
        rh: 0.12,
        gh: 0.06,
        bh: -0.08
      }
    }
  },
  {
    id: 'agfa-vista',
    category: 'film',
    labelZh: '爱克发浓郁',
    labelEn: 'Agfa Vista',
    descZh: 'Agfa Vista 200 浓郁明快红黄色彩与复古反差',
    descEn: 'Punchy Agfa Vista 200 warm reds and vibrant greens',
    badge: 'AGFA',
    accent: '#ef4444',
    previewGradient: 'linear-gradient(135deg, #7f1d1d 0%, #dc2626 48%, #facc15 100%)',
    iconPath:
      'M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 3a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z',
    recipe: {
      brightness: 0.02,
      contrast: 1.16,
      saturation: 1.26,
      sepia: 0.1,
      hueRotateDeg: -5,
      temperature: 16,
      tint: 6,
      vignette: 16,
      fade: 6,
      colorBalance: {
        rs: 0.1,
        gs: 0.02,
        bs: -0.08,
        rm: 0.12,
        gm: 0.04,
        bm: -0.08,
        rh: 0.12,
        gh: 0.04,
        bh: -0.06
      }
    }
  },
  {
    id: 'polaroid-fade',
    category: 'film',
    labelZh: '宝丽来相纸',
    labelEn: 'Polaroid 600',
    descZh: '一次成像撕拉片柔和褪色暗部与奶油暖调高光',
    descEn: 'Instant film lifted matte blacks and creamy warm highlights',
    badge: 'INST',
    accent: '#f472b6',
    previewGradient: 'linear-gradient(135deg, #334155 0%, #f472b6 52%, #fef3c7 100%)',
    iconPath: 'M4 3.5h12v13H4v-13Zm2 2h8v6.5H6V5.5Z',
    recipe: {
      brightness: 0.05,
      contrast: 0.94,
      saturation: 0.9,
      sepia: 0.18,
      hueRotateDeg: -3,
      temperature: 14,
      tint: 10,
      vignette: 18,
      fade: 24,
      colorBalance: {
        rs: 0.04,
        gs: -0.02,
        bs: 0.06,
        rm: 0.06,
        gm: 0.02,
        bm: -0.04,
        rh: 0.1,
        gh: 0.06,
        bh: -0.04
      }
    }
  },
  {
    id: 'hk-retro',
    category: 'film',
    labelZh: '复古港风',
    labelEn: 'HK Retro',
    descZh: '王家卫式浓郁暖绿暗调、绯红高光与怀旧暗角',
    descEn: '90s Hong Kong cinema lush greens and warm crimson tones',
    badge: 'HK90',
    accent: '#ef4444',
    previewGradient: 'linear-gradient(135deg, #14532d 0%, #b91c1c 55%, #f59e0b 100%)',
    iconPath: 'M3 5h14v10H3V5Zm4 0v10m6-10v10',
    recipe: {
      brightness: -0.03,
      contrast: 1.2,
      saturation: 1.16,
      sepia: 0.24,
      hueRotateDeg: -8,
      temperature: 24,
      tint: -10,
      vignette: 30,
      fade: 10,
      colorBalance: {
        rs: 0.04,
        gs: 0.08,
        bs: -0.12,
        rm: 0.12,
        gm: 0.04,
        bm: -0.14,
        rh: 0.16,
        gh: -0.02,
        bh: -0.14
      }
    }
  },
  {
    id: 'vintage-sepia',
    category: 'film',
    labelZh: '怀旧泛黄',
    labelEn: 'Vintage Sepia',
    descZh: '温暖褐色老照片影调与柔和褪色灰雾',
    descEn: 'Nostalgic warm sepia tone with soft faded blacks',
    badge: 'SEPIA',
    accent: '#d97706',
    previewGradient: 'linear-gradient(135deg, #292524 0%, #92400e 52%, #fde68a 100%)',
    iconPath: 'M10 4v6l4 2M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z',
    recipe: {
      brightness: 0.01,
      contrast: 1.05,
      saturation: 0.72,
      sepia: 0.55,
      hueRotateDeg: -5,
      temperature: 28,
      tint: 2,
      vignette: 24,
      fade: 18,
      colorBalance: {
        rs: 0.12,
        gs: 0.05,
        bs: -0.16,
        rm: 0.14,
        gm: 0.06,
        bm: -0.18,
        rh: 0.1,
        gh: 0.04,
        bh: -0.12
      }
    }
  },
  {
    id: 'cream-skin',
    category: 'portrait',
    labelZh: '奶油肌理',
    labelEn: 'Creamy Skin',
    descZh: '柔和提亮肤色、弱化暗部反差，呈现细腻奶油质感',
    descEn: 'Soft luminous skin tones with gentle low-contrast roll-off',
    badge: 'CREAM',
    accent: '#fda4af',
    previewGradient: 'linear-gradient(135deg, #be185d 0%, #fb7185 48%, #fff1f2 100%)',
    iconPath: 'M10 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 7a5 5 0 0 1 10 0',
    recipe: {
      brightness: 0.06,
      contrast: 0.93,
      saturation: 0.94,
      sepia: 0.06,
      hueRotateDeg: -2,
      temperature: 10,
      tint: 8,
      vignette: 6,
      fade: 14,
      colorBalance: {
        rs: 0.04,
        gs: 0.01,
        bs: 0.02,
        rm: 0.06,
        gm: 0.02,
        bm: 0,
        rh: 0.08,
        gh: 0.04,
        bh: 0.02
      }
    }
  },
  {
    id: 'peach-oolong',
    category: 'portrait',
    labelZh: '蜜桃乌龙',
    labelEn: 'Peach Oolong',
    descZh: '甜美粉橘蜜桃色调，适合穿搭、美妆与特写镜头',
    descEn: 'Sweet warm peach-pink tone for beauty and fashion shots',
    badge: 'PEACH',
    accent: '#fb7185',
    previewGradient: 'linear-gradient(135deg, #9f1239 0%, #f43f5e 48%, #fed7aa 100%)',
    iconPath: 'M10 16.5s-6-3.8-6-8.2A3.5 3.5 0 0 1 10 6a3.5 3.5 0 0 1 6 2.3c0 4.4-6 8.2-6 8.2Z',
    recipe: {
      brightness: 0.05,
      contrast: 1.02,
      saturation: 1.12,
      sepia: 0.08,
      hueRotateDeg: -6,
      temperature: 14,
      tint: 18,
      vignette: 8,
      fade: 8,
      colorBalance: {
        rs: 0.08,
        gs: -0.02,
        bs: 0.02,
        rm: 0.12,
        gm: -0.02,
        bm: 0.04,
        rh: 0.12,
        gh: 0.02,
        bh: 0.04
      }
    }
  },
  {
    id: 'cold-porcelain',
    category: 'portrait',
    labelZh: '清冷白瓷',
    labelEn: 'Cold Porcelain',
    descZh: '清透冷白皮质感，压低杂色黄气，突出高级清冷氛围',
    descEn: 'Cool porcelain skin tone removing yellow cast for editorial look',
    badge: 'COOL',
    accent: '#93c5fd',
    previewGradient: 'linear-gradient(135deg, #1e3a8a 0%, #60a5fa 50%, #f8fafc 100%)',
    iconPath: 'M10 2.5 12 8l5.5 2L12 12l-2 5.5L8 12 2.5 10 8 8l2-5.5Z',
    recipe: {
      brightness: 0.06,
      contrast: 1.05,
      saturation: 0.84,
      sepia: 0,
      hueRotateDeg: 4,
      temperature: -18,
      tint: 6,
      vignette: 8,
      fade: 6,
      colorBalance: {
        rs: -0.04,
        gs: 0,
        bs: 0.08,
        rm: -0.04,
        gm: 0.02,
        bm: 0.08,
        rh: 0.02,
        gh: 0.04,
        bh: 0.1
      }
    }
  },
  {
    id: 'japanese-fresh',
    category: 'portrait',
    labelZh: '日系清新',
    labelEn: 'Airy Fresh',
    descZh: '高明度低反差、清透空气感偏青蓝调色',
    descEn: 'Bright airy exposure with soft pastel cyan-green tones',
    badge: 'AIRY',
    accent: '#38bdf8',
    previewGradient: 'linear-gradient(135deg, #0284c7 0%, #38bdf8 50%, #ecfeff 100%)',
    iconPath: 'M4 12a4 4 0 0 1 4-4 4.5 4.5 0 0 1 8.5 1.5A3 3 0 0 1 16 15.5H5A3.5 3.5 0 0 1 4 12Z',
    recipe: {
      brightness: 0.07,
      contrast: 0.92,
      saturation: 0.9,
      sepia: 0,
      hueRotateDeg: 5,
      temperature: -12,
      tint: -6,
      vignette: 0,
      fade: 16,
      colorBalance: {
        rs: -0.04,
        gs: 0.04,
        bs: 0.08,
        rm: -0.02,
        gm: 0.04,
        bm: 0.06,
        rh: 0.02,
        gh: 0.06,
        bh: 0.08
      }
    }
  },
  {
    id: 'kamakura-sea',
    category: 'nature',
    labelZh: '镰仓海风',
    labelEn: 'Kamakura Sea',
    descZh: '晴空蔚蓝与清爽海盐绿意，适合夏日海边与旅行外景',
    descEn: 'Crisp ocean cyan-blue and summer breeze tones',
    badge: 'SEA',
    accent: '#0ea5e9',
    previewGradient: 'linear-gradient(135deg, #0369a1 0%, #0ea5e9 52%, #bae6fd 100%)',
    iconPath: 'M2.5 11.5c2-2 4-2 6 0s4 2 6 0 2-1 3 0M2.5 15c2-2 4-2 6 0s4 2 6 0 2-1 3 0',
    recipe: {
      brightness: 0.04,
      contrast: 1.08,
      saturation: 1.16,
      sepia: 0,
      hueRotateDeg: 6,
      temperature: -20,
      tint: -8,
      vignette: 6,
      fade: 6,
      colorBalance: {
        rs: -0.08,
        gs: 0.04,
        bs: 0.14,
        rm: -0.06,
        gm: 0.06,
        bm: 0.12,
        rh: 0,
        gh: 0.06,
        bh: 0.12
      }
    }
  },
  {
    id: 'emerald-forest',
    category: 'nature',
    labelZh: '绿野仙踪',
    labelEn: 'Emerald Forest',
    descZh: '深邃森系祖母绿与柔和阳光丁达尔氛围',
    descEn: 'Deep woodland emerald greens with warm sunbeams',
    badge: 'WOODS',
    accent: '#10b981',
    previewGradient: 'linear-gradient(135deg, #064e3b 0%, #10b981 55%, #d9f99d 100%)',
    iconPath: 'M10 3 5 10h3.5L6 15h8l-2.5-5H15L10 3Zm0 12v3',
    recipe: {
      brightness: -0.01,
      contrast: 1.12,
      saturation: 1.1,
      sepia: 0.06,
      hueRotateDeg: 10,
      temperature: -6,
      tint: -18,
      vignette: 20,
      fade: 8,
      colorBalance: {
        rs: -0.08,
        gs: 0.1,
        bs: -0.02,
        rm: -0.04,
        gm: 0.12,
        bm: -0.04,
        rh: 0.06,
        gh: 0.08,
        bh: -0.04
      }
    }
  },
  {
    id: 'sunset-glow',
    category: 'nature',
    labelZh: '落日余晖',
    labelEn: 'Sunset Glow',
    descZh: '浪漫暮光橘粉渐变，为画面注入黄昏黄金时刻氛围',
    descEn: 'Golden hour warm coral-amber glow and soft contrast',
    badge: 'SUNSET',
    accent: '#fb7185',
    previewGradient: 'linear-gradient(135deg, #4c0519 0%, #e11d48 48%, #fbbf24 100%)',
    iconPath: 'M3 14h14M5.5 14a4.5 4.5 0 0 1 9 0M10 4v2.5M4.8 6.8l1.8 1.8m8.6-1.8-1.8 1.8',
    recipe: {
      brightness: 0.03,
      contrast: 1.1,
      saturation: 1.24,
      sepia: 0.18,
      hueRotateDeg: -10,
      temperature: 32,
      tint: 14,
      vignette: 15,
      fade: 4,
      colorBalance: {
        rs: 0.12,
        gs: -0.02,
        bs: -0.1,
        rm: 0.16,
        gm: 0.02,
        bm: -0.12,
        rh: 0.18,
        gh: 0.06,
        bh: -0.1
      }
    }
  },
  {
    id: 'golden-autumn',
    category: 'nature',
    labelZh: '金秋暖阳',
    labelEn: 'Golden Autumn',
    descZh: '浓郁枫叶焦糖金棕，凸显秋日温暖叙事感',
    descEn: 'Rich maple amber and caramel autumn warmth',
    badge: 'AUTUMN',
    accent: '#f59e0b',
    previewGradient: 'linear-gradient(135deg, #78350f 0%, #d97706 50%, #fde047 100%)',
    iconPath: 'M16 4c-6 0-11 5-11 11 6 0 11-5 11-11ZM5 15l7-7',
    recipe: {
      brightness: 0.02,
      contrast: 1.14,
      saturation: 1.18,
      sepia: 0.24,
      hueRotateDeg: -8,
      temperature: 28,
      tint: 4,
      vignette: 16,
      fade: 6,
      colorBalance: {
        rs: 0.1,
        gs: 0.04,
        bs: -0.12,
        rm: 0.14,
        gm: 0.06,
        bm: -0.14,
        rh: 0.14,
        gh: 0.08,
        bh: -0.1
      }
    }
  },
  {
    id: 'nordic-cold',
    category: 'nature',
    labelZh: '冷冽北欧',
    labelEn: 'Nordic Cold',
    descZh: '克制低饱和冰蓝冷调，适合悬疑、科技与极简叙事',
    descEn: 'Desaturated icy blue grading for minimal and thriller moods',
    badge: 'COLD',
    accent: '#60a5fa',
    previewGradient: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 50%, #93c5fd 100%)',
    iconPath: 'M10 2.5v15M3.5 6.2l13 7.6m0-7.6-13 7.6',
    recipe: {
      brightness: -0.01,
      contrast: 1.14,
      saturation: 0.78,
      sepia: 0,
      hueRotateDeg: 8,
      temperature: -30,
      tint: -4,
      vignette: 16,
      fade: 6,
      colorBalance: {
        rs: -0.12,
        gs: -0.02,
        bs: 0.16,
        rm: -0.1,
        gm: 0,
        bm: 0.14,
        rh: -0.06,
        gh: 0.02,
        bh: 0.12
      }
    }
  },
  {
    id: 'anime-vivid',
    category: 'style',
    labelZh: '动漫绚丽',
    labelEn: 'Anime Vivid',
    descZh: '新海诚式高饱和通透蓝天与明亮反差色彩',
    descEn: 'Vibrant anime sky blues and punchy saturated colors',
    badge: 'VIVID',
    accent: '#6366f1',
    previewGradient: 'linear-gradient(135deg, #1d4ed8 0%, #3b82f6 48%, #f472b6 100%)',
    iconPath: 'M10 2.5 12 7.5l5 2-5 2-2 5-2-5-5-2 5-2 2-5Z',
    recipe: {
      brightness: 0.04,
      contrast: 1.15,
      saturation: 1.38,
      sepia: 0,
      hueRotateDeg: 0,
      temperature: -4,
      tint: 6,
      vignette: 0,
      fade: 0,
      colorBalance: {
        rs: -0.04,
        gs: 0.02,
        bs: 0.1,
        rm: 0.02,
        gm: 0.02,
        bm: 0.08,
        rh: 0.06,
        gh: 0.04,
        bh: 0.1
      }
    }
  },
  {
    id: 'morandi-gray',
    category: 'style',
    labelZh: '莫兰迪灰',
    labelEn: 'Morandi Gray',
    descZh: '低饱和度高级灰雾色调，呈现静谧艺术馆质感',
    descEn: 'Muted low-saturation Morandi pastel gray palette',
    badge: 'MUTE',
    accent: '#94a3b8',
    previewGradient: 'linear-gradient(135deg, #334155 0%, #64748b 50%, #cbd5e1 100%)',
    iconPath: 'M4 6h12v8H4V6Zm3 2h6v4H7V8Z',
    recipe: {
      brightness: 0.02,
      contrast: 0.94,
      saturation: 0.62,
      sepia: 0.08,
      hueRotateDeg: 0,
      temperature: -4,
      tint: 2,
      vignette: 12,
      fade: 22,
      colorBalance: {
        rs: -0.02,
        gs: 0,
        bs: 0.02,
        rm: 0,
        gm: 0.01,
        bm: 0.02,
        rh: 0.02,
        gh: 0.02,
        bh: 0.02
      }
    }
  },
  {
    id: 'vaporwave',
    category: 'style',
    labelZh: '蒸汽波紫粉',
    labelEn: 'Vaporwave',
    descZh: '80年代复古合成器电光粉紫与落日青梦幻撞色',
    descEn: '80s synthwave neon magenta, violet and cyan dreamscape',
    badge: 'VAPOR',
    accent: '#e879f9',
    previewGradient: 'linear-gradient(135deg, #3b0764 0%, #ec4899 52%, #22d3ee 100%)',
    iconPath: 'M3 14h14M6 14a4 4 0 0 1 8 0M3 16.5h14',
    recipe: {
      brightness: 0.03,
      contrast: 1.14,
      saturation: 1.32,
      sepia: 0,
      hueRotateDeg: -18,
      temperature: -10,
      tint: 34,
      vignette: 16,
      fade: 8,
      colorBalance: {
        rs: 0.08,
        gs: -0.12,
        bs: 0.18,
        rm: 0.14,
        gm: -0.1,
        bm: 0.16,
        rh: 0.08,
        gh: 0.06,
        bh: 0.18
      }
    }
  }
] as const

export type TimelineAdjustmentKey =
  | 'brightness'
  | 'contrast'
  | 'saturation'
  | 'vibrance'
  | 'temperature'
  | 'tint'
  | 'highlights'
  | 'shadows'
  | 'sharpen'
  | 'vignette'
  | 'fade'
  | 'grain'

export interface TimelineAdjustmentControlMeta {
  key: TimelineAdjustmentKey
  labelZh: string
  labelEn: string
  iconPath: string
  min: number
  max: number
  step: number
  defaultValue: number
  /** 用于 UI 展示为 -100..100 或 0..100 整数 */
  formatDisplay: (val: number) => string
}

export const TIMELINE_ADJUSTMENT_CONTROLS: readonly TimelineAdjustmentControlMeta[] = [
  {
    key: 'brightness',
    labelZh: '亮度',
    labelEn: 'Brightness',
    iconPath:
      'M10 6.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6ZM10 2.5v2m0 11v2M4.7 4.7l1.4 1.4m7.8 7.8 1.4 1.4M2.5 10h2m11 0h2M4.7 15.3l1.4-1.4m7.8-7.8 1.4-1.4',
    min: -0.5,
    max: 0.5,
    step: 0.01,
    defaultValue: 0,
    formatDisplay: (v) => `${v > 0.002 ? '+' : ''}${Math.round(v * 200)}`
  },
  {
    key: 'contrast',
    labelZh: '对比度',
    labelEn: 'Contrast',
    iconPath: 'M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 0v13',
    min: 0.5,
    max: 2,
    step: 0.02,
    defaultValue: 1,
    formatDisplay: (v) => `${v > 1.005 ? '+' : ''}${Math.round((v - 1) * 100)}`
  },
  {
    key: 'saturation',
    labelZh: '饱和度',
    labelEn: 'Saturation',
    iconPath: 'M10 3s5 5.4 5 8.8a5 5 0 0 1-10 0C5 8.4 10 3 10 3Z',
    min: 0,
    max: 2.5,
    step: 0.02,
    defaultValue: 1,
    formatDisplay: (v) => `${v > 1.005 ? '+' : ''}${Math.round((v - 1) * 100)}`
  },
  {
    key: 'vibrance',
    labelZh: '自然饱和度',
    labelEn: 'Vibrance',
    iconPath: 'M10 2.8 12 7.5l4.8 1.2-3.5 3.4.8 4.9-4.1-2.2-4.1 2.2.8-4.9-3.5-3.4L8 7.5 10 2.8Z',
    min: -100,
    max: 100,
    step: 1,
    defaultValue: 0,
    formatDisplay: (v) => `${v > 0 ? '+' : ''}${Math.round(v)}`
  },
  {
    key: 'temperature',
    labelZh: '色温',
    labelEn: 'Temp',
    iconPath: 'M10 3v9.5a2.5 2.5 0 1 1-2 0V3a1 1 0 0 1 2 0Zm3.5 2h2m-2 3h1.5m-1.5 3h2',
    min: -100,
    max: 100,
    step: 1,
    defaultValue: 0,
    formatDisplay: (v) => `${v > 0 ? '+' : ''}${Math.round(v)}`
  },
  {
    key: 'tint',
    labelZh: '色调',
    labelEn: 'Tint',
    iconPath: 'M15.5 4.5c-5.5 0-10 4.5-10 10 5.5 0 10-4.5 10-10ZM5.5 14.5l6.5-6.5',
    min: -100,
    max: 100,
    step: 1,
    defaultValue: 0,
    formatDisplay: (v) => `${v > 0 ? '+' : ''}${Math.round(v)}`
  },
  {
    key: 'highlights',
    labelZh: '高光',
    labelEn: 'Highlights',
    iconPath: 'M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 2.5a4 4 0 0 1 4 4',
    min: -100,
    max: 100,
    step: 1,
    defaultValue: 0,
    formatDisplay: (v) => `${v > 0 ? '+' : ''}${Math.round(v)}`
  },
  {
    key: 'shadows',
    labelZh: '阴影',
    labelEn: 'Shadows',
    iconPath: 'M12.5 3.8a6.2 6.2 0 1 0 3.7 11.2 5.5 5.5 0 0 1-3.7-11.2Z',
    min: -100,
    max: 100,
    step: 1,
    defaultValue: 0,
    formatDisplay: (v) => `${v > 0 ? '+' : ''}${Math.round(v)}`
  },
  {
    key: 'sharpen',
    labelZh: '锐化',
    labelEn: 'Sharpen',
    iconPath: 'M10 3.2 16.2 16H3.8L10 3.2Zm0 4.3v8.5',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 0,
    formatDisplay: (v) => `${Math.round(v)}`
  },
  {
    key: 'vignette',
    labelZh: '暗角',
    labelEn: 'Vignette',
    iconPath: 'M3 4h14v12H3V4Zm7 2.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 0,
    formatDisplay: (v) => `${Math.round(v)}`
  },
  {
    key: 'fade',
    labelZh: '褪色',
    labelEn: 'Fade',
    iconPath: 'M3.5 6.5h13M5 10h10M6.5 13.5h7',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 0,
    formatDisplay: (v) => `${Math.round(v)}`
  },
  {
    key: 'grain',
    labelZh: '颗粒',
    labelEn: 'Grain',
    iconPath:
      'M5 5h1.5v1.5H5V5Zm4.5 1h1.5v1.5H9.5V6Zm4.5-1h1.5v1.5H14V5ZM6 9.5h1.5V11H6V9.5Zm5 0h1.5V11H11V9.5Zm-6 4.5h1.5v1.5H5V14Zm4.5-1h1.5v1.5H9.5V13Zm4.5 1h1.5v1.5H14V14Z',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 0,
    formatDisplay: (v) => `${Math.round(v)}`
  }
] as const

export interface TimelineCreativeTemplateMeta {
  id: TimelineCreativeTemplateId
  labelZh: string
  labelEn: string
  descZh: string
  descEn: string
  badge: string
  accent: string
  previewGradient: string
  iconPath: string
  tagsZh: readonly string[]
  tagsEn: readonly string[]
  /** 综合配方 */
  recipe: {
    transitionType: Exclude<ScriptTimelineTransitionType, 'none'>
    transitionDurationSec: number
    alternatingTransitions?: readonly Exclude<ScriptTimelineTransitionType, 'none'>[]
    filterPreset: TimelineFilterPresetId
    filterIntensity: number
    visualEffect: TimelineVisualEffectId
    effectIntensity: number
    cameraMotions: readonly TimelineMainCameraPreset[]
    tweenIn: TimelineTweenInPreset
    tweenOut: TimelineTweenOutPreset
    adjustments: Partial<TimelineClipCreativeProps>
    subtitleStyle: {
      subtitleColor: string
      subtitleBorderColor: string
      subtitleBorderWidth: number
      subtitleBoxEnabled: boolean
      subtitleBoxColor: string
      subtitleBoxOpacity: number
      subtitleMotion: 'fade' | 'none'
    }
  }
}

export const TIMELINE_CREATIVE_TEMPLATES: readonly TimelineCreativeTemplateMeta[] = [
  {
    id: 'high-energy-beat',
    labelZh: '高燃卡点快剪',
    labelEn: 'High-Energy Beat Cut',
    descZh: '闪白+穿梭推进转场、律动脉冲特效、青橙高反差调色与动感推拉运镜',
    descEn:
      'Flash & zoom transitions, beat pulse FX, Teal & Orange grading and dynamic camera motion',
    badge: 'HOT',
    accent: '#f97316',
    previewGradient: 'linear-gradient(135deg, #7c2d12 0%, #ea580c 50%, #facc15 100%)',
    iconPath: 'M11 2.2 4.5 10.8h5l-1 7L15.5 9.2h-5l0.5-7Z',
    tagsZh: ['闪白转场', '律动脉冲', '青橙大片', '推拉运镜'],
    tagsEn: ['Flash Cut', 'Beat Pulse', 'Teal & Orange', 'Dynamic Zoom'],
    recipe: {
      transitionType: 'flash',
      transitionDurationSec: 0.35,
      alternatingTransitions: ['flash', 'zoomin', 'smoothleft', 'smoothright'],
      filterPreset: 'teal-orange',
      filterIntensity: 90,
      visualEffect: 'beat-pulse',
      effectIntensity: 70,
      cameraMotions: ['kenBurnsIn', 'kenBurnsOut', 'panRight', 'panLeft'],
      tweenIn: 'popIn',
      tweenOut: 'fadeOut',
      adjustments: {
        contrast: 1.12,
        saturation: 1.15,
        sharpen: 25,
        vignette: 18
      },
      subtitleStyle: {
        subtitleColor: '#facc15',
        subtitleBorderColor: '#000000',
        subtitleBorderWidth: 4,
        subtitleBoxEnabled: false,
        subtitleBoxColor: '#000000',
        subtitleBoxOpacity: 0.55,
        subtitleMotion: 'fade'
      }
    }
  },
  {
    id: 'black-gold-cinema',
    labelZh: '黑金电影叙事',
    labelEn: 'Black Gold Cinema',
    descZh: '2.35:1 宽银幕遮幅、黑金都市滤镜、柔和叠化转场与沉稳电影推镜',
    descEn: '2.35:1 cinema letterbox, Black Gold LUT, smooth dissolve and slow cinematic push',
    badge: 'FILM',
    accent: '#eab308',
    previewGradient: 'linear-gradient(135deg, #090d16 0%, #27272a 48%, #f59e0b 100%)',
    iconPath: 'M2.5 4.5h15v11h-15v-11ZM2.5 7.2h15M2.5 12.8h15',
    tagsZh: ['2.35:1 遮幅', '黑金滤镜', '柔和叠化', '电影字幕'],
    tagsEn: ['2.35:1 Scope', 'Black Gold', 'Dissolve', 'Cinema Sub'],
    recipe: {
      transitionType: 'dissolve',
      transitionDurationSec: 0.55,
      alternatingTransitions: ['dissolve', 'fade'],
      filterPreset: 'black-gold',
      filterIntensity: 95,
      visualEffect: 'cinema-letterbox',
      effectIntensity: 85,
      cameraMotions: ['kenBurnsIn', 'panRight', 'kenBurnsOut', 'panLeft'],
      tweenIn: 'fadeIn',
      tweenOut: 'fadeOut',
      adjustments: {
        contrast: 1.1,
        vignette: 25,
        sharpen: 18
      },
      subtitleStyle: {
        subtitleColor: '#fef08a',
        subtitleBorderColor: '#000000',
        subtitleBorderWidth: 3,
        subtitleBoxEnabled: true,
        subtitleBoxColor: '#090d16',
        subtitleBoxOpacity: 0.5,
        subtitleMotion: 'fade'
      }
    }
  },
  {
    id: 'cyber-neon-drama',
    labelZh: '赛博霓虹短剧',
    labelEn: 'Cyber Neon Drama',
    descZh: 'RGB 故障色差特效、赛博霓虹冷调滤镜、像素/甩镜切点与青色发光字幕',
    descEn: 'RGB glitch FX, Cyberpunk neon filter, whip/pixel transitions and cyan subtitles',
    badge: 'CYBER',
    accent: '#ec4899',
    previewGradient: 'linear-gradient(135deg, #1e1b4b 0%, #ec4899 52%, #06b6d4 100%)',
    iconPath: 'M4 6h9M7 10h9M5 14h8M14 4.5l2.5 1.5-2.5 1.5',
    tagsZh: ['故障色差', '赛博霓虹', '甩镜像素', '霓虹字幕'],
    tagsEn: ['RGB Glitch', 'Cyberpunk', 'Pixel Whip', 'Cyan Sub'],
    recipe: {
      transitionType: 'smoothleft',
      transitionDurationSec: 0.4,
      alternatingTransitions: ['smoothleft', 'pixelize', 'smoothright', 'zoomin'],
      filterPreset: 'cyberpunk',
      filterIntensity: 92,
      visualEffect: 'rgb-glitch',
      effectIntensity: 68,
      cameraMotions: ['kenBurnsIn', 'panUp', 'kenBurnsOut', 'panDown'],
      tweenIn: 'slideLeft',
      tweenOut: 'fadeOut',
      adjustments: {
        contrast: 1.14,
        saturation: 1.18,
        temperature: -18,
        tint: 18,
        sharpen: 22
      },
      subtitleStyle: {
        subtitleColor: '#22d3ee',
        subtitleBorderColor: '#0f172a',
        subtitleBorderWidth: 4,
        subtitleBoxEnabled: true,
        subtitleBoxColor: '#0f172a',
        subtitleBoxOpacity: 0.65,
        subtitleMotion: 'fade'
      }
    }
  },
  {
    id: 'fuji-vlog',
    labelZh: '富士胶片日常',
    labelEn: 'Fuji Film Vlog',
    descZh: '富士 Classic Chrome 胶片色、柔光梦幻氛围、轻柔推拉与干净白字',
    descEn: 'Fuji Classic Chrome film tone, dreamy bloom, gentle pan and clean white captions',
    badge: 'VLOG',
    accent: '#10b981',
    previewGradient: 'linear-gradient(135deg, #064e3b 0%, #10b981 52%, #fef3c7 100%)',
    iconPath:
      'M3.5 6h13v9h-13V6Zm3-2h7l1 2h-9l1-2Zm3.5 3.5a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z',
    tagsZh: ['富士胶片', '柔光梦幻', '丝滑推镜', '极简字幕'],
    tagsEn: ['Fuji Film', 'Dreamy Bloom', 'Smooth Slide', 'Clean Sub'],
    recipe: {
      transitionType: 'dissolve',
      transitionDurationSec: 0.5,
      alternatingTransitions: ['dissolve', 'smoothleft', 'dissolve', 'smoothright'],
      filterPreset: 'fuji-classic',
      filterIntensity: 90,
      visualEffect: 'dreamy-bloom',
      effectIntensity: 55,
      cameraMotions: ['panRight', 'kenBurnsIn', 'panLeft', 'kenBurnsOut'],
      tweenIn: 'fadeIn',
      tweenOut: 'fadeOut',
      adjustments: {
        fade: 10,
        grain: 16,
        vignette: 12
      },
      subtitleStyle: {
        subtitleColor: '#ffffff',
        subtitleBorderColor: '#1e293b',
        subtitleBorderWidth: 3,
        subtitleBoxEnabled: false,
        subtitleBoxColor: '#000000',
        subtitleBoxOpacity: 0.45,
        subtitleMotion: 'fade'
      }
    }
  },
  {
    id: 'hk-retro-memory',
    labelZh: '复古港风记忆',
    labelEn: 'HK Retro Memory',
    descZh: '90年代港产片浓郁暖绿红调、老电影银盐颗粒与渐隐呼吸转场',
    descEn: '90s Hong Kong cinema grading, vintage film grain and dip-fade transitions',
    badge: 'RETRO',
    accent: '#ef4444',
    previewGradient: 'linear-gradient(135deg, #14532d 0%, #b91c1c 52%, #f59e0b 100%)',
    iconPath: 'M3 4h14v12H3V4Zm3 0v12m8-12v12',
    tagsZh: ['复古港风', '老电影颗粒', '渐隐过渡', '暖黄字幕'],
    tagsEn: ['HK Retro', 'Old Film', 'Dip Fade', 'Amber Sub'],
    recipe: {
      transitionType: 'fade',
      transitionDurationSec: 0.55,
      alternatingTransitions: ['fade', 'dissolve'],
      filterPreset: 'hk-retro',
      filterIntensity: 95,
      visualEffect: 'old-film',
      effectIntensity: 65,
      cameraMotions: ['kenBurnsIn', 'panLeft', 'kenBurnsOut', 'panRight'],
      tweenIn: 'fadeIn',
      tweenOut: 'fadeOut',
      adjustments: {
        temperature: 16,
        vignette: 28,
        grain: 26,
        fade: 12
      },
      subtitleStyle: {
        subtitleColor: '#fde68a',
        subtitleBorderColor: '#1c1917',
        subtitleBorderWidth: 3,
        subtitleBoxEnabled: false,
        subtitleBoxColor: '#000000',
        subtitleBoxOpacity: 0.5,
        subtitleMotion: 'fade'
      }
    }
  },
  {
    id: 'japanese-fresh-album',
    labelZh: '日系清新相册',
    labelEn: 'Airy Pastel Album',
    descZh: '日系空气感高明度调色、虚焦渐入镜头与圆形光圈转场',
    descEn: 'Bright airy pastel filter, blur-focus entrance and iris transitions',
    badge: 'FRESH',
    accent: '#38bdf8',
    previewGradient: 'linear-gradient(135deg, #0284c7 0%, #38bdf8 50%, #ecfeff 100%)',
    iconPath: 'M4 12a4 4 0 0 1 4-4 4.5 4.5 0 0 1 8.5 1.5A3 3 0 0 1 16 15.5H5A3.5 3.5 0 0 1 4 12Z',
    tagsZh: ['日系清新', '虚焦渐入', '光圈展开', '清透空气感'],
    tagsEn: ['Airy Fresh', 'Blur Focus', 'Iris Open', 'Pastel Tone'],
    recipe: {
      transitionType: 'circleopen',
      transitionDurationSec: 0.5,
      alternatingTransitions: ['circleopen', 'dissolve', 'horzopen', 'dissolve'],
      filterPreset: 'japanese-fresh',
      filterIntensity: 90,
      visualEffect: 'blur-focus',
      effectIntensity: 60,
      cameraMotions: ['kenBurnsOut', 'panUp', 'kenBurnsIn', 'panDown'],
      tweenIn: 'fadeIn',
      tweenOut: 'fadeOut',
      adjustments: {
        brightness: 0.04,
        fade: 14,
        temperature: -10
      },
      subtitleStyle: {
        subtitleColor: '#ffffff',
        subtitleBorderColor: '#0369a1',
        subtitleBorderWidth: 2,
        subtitleBoxEnabled: false,
        subtitleBoxColor: '#000000',
        subtitleBoxOpacity: 0.4,
        subtitleMotion: 'fade'
      }
    }
  },
  {
    id: 'noir-documentary',
    labelZh: '悬疑黑白纪实',
    labelEn: 'Noir Documentary',
    descZh: '高反差黑白聚光、深邃暗角、银盐锐化与冷峻纪实运镜',
    descEn: 'High-contrast noir spotlight, deep vignette, crisp grain and documentary camera',
    badge: 'NOIR',
    accent: '#94a3b8',
    previewGradient: 'linear-gradient(135deg, #020617 0%, #475569 52%, #f8fafc 100%)',
    iconPath: 'M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 0v13',
    tagsZh: ['黑白聚光', '深邃暗角', '银盐颗粒', '纪实叙事'],
    tagsEn: ['Noir B&W', 'Spotlight', 'Film Grain', 'Documentary'],
    recipe: {
      transitionType: 'fade',
      transitionDurationSec: 0.5,
      alternatingTransitions: ['fade', 'wipeleft', 'fade', 'wiperight'],
      filterPreset: 'noir-bw',
      filterIntensity: 100,
      visualEffect: 'bw-spotlight',
      effectIntensity: 75,
      cameraMotions: ['kenBurnsIn', 'kenBurnsOut'],
      tweenIn: 'fadeIn',
      tweenOut: 'fadeOut',
      adjustments: {
        contrast: 1.24,
        saturation: 0,
        sharpen: 30,
        vignette: 36,
        grain: 22
      },
      subtitleStyle: {
        subtitleColor: '#f8fafc',
        subtitleBorderColor: '#020617',
        subtitleBorderWidth: 3,
        subtitleBoxEnabled: true,
        subtitleBoxColor: '#020617',
        subtitleBoxOpacity: 0.65,
        subtitleMotion: 'fade'
      }
    }
  },
  {
    id: 'vhs-retro-tape',
    labelZh: '复古 VHS 磁带',
    labelEn: '90s VHS Camcorder',
    descZh: '千禧年家用磁带摄像机扫描线、柯达暖调、色度偏移与动感微震',
    descEn: 'Y2K camcorder scanlines, Kodak warm tint, chroma bleed and handheld feel',
    badge: 'VHS',
    accent: '#22d3ee',
    previewGradient: 'linear-gradient(135deg, #164e63 0%, #06b6d4 50%, #f43f5e 100%)',
    iconPath: 'M2.5 5h15v10h-15V5Zm4 5a1.6 1.6 0 1 0 0 .01Zm7 0a1.6 1.6 0 1 0 0 .01ZM6.5 12h7',
    tagsZh: ['VHS 扫描线', '柯达暖金', '像素切镜', '复古磁带'],
    tagsEn: ['VHS Scanlines', 'Kodak Warm', 'Pixel Cut', 'Y2K Tape'],
    recipe: {
      transitionType: 'pixelize',
      transitionDurationSec: 0.4,
      alternatingTransitions: ['pixelize', 'flash', 'slideleft', 'slideright'],
      filterPreset: 'kodak-portra',
      filterIntensity: 88,
      visualEffect: 'vhs-retro',
      effectIntensity: 80,
      cameraMotions: ['kenBurnsIn', 'panRight', 'kenBurnsOut', 'panLeft'],
      tweenIn: 'popIn',
      tweenOut: 'fadeOut',
      adjustments: {
        contrast: 1.08,
        grain: 30,
        fade: 15,
        vignette: 22
      },
      subtitleStyle: {
        subtitleColor: '#fde047',
        subtitleBorderColor: '#000000',
        subtitleBorderWidth: 3,
        subtitleBoxEnabled: false,
        subtitleBoxColor: '#000000',
        subtitleBoxOpacity: 0.5,
        subtitleMotion: 'none'
      }
    }
  },
  {
    id: 'anime-opening',
    labelZh: '新海诚动漫番剧',
    labelEn: 'Anime Opening Cut',
    descZh: '动漫绚丽蓝天滤镜、星光闪闪特效、百叶/穿梭切点与高燃字幕',
    descEn: 'Vibrant anime LUT, starlight sparkle FX, blinds/zoom cuts and crisp anime captions',
    badge: 'ANIME',
    accent: '#6366f1',
    previewGradient: 'linear-gradient(135deg, #1d4ed8 0%, #3b82f6 48%, #f472b6 100%)',
    iconPath: 'M10 2l1.6 5.4L17 9l-5.4 1.6L10 16l-1.6-5.4L3 9l5.4-1.6L10 2Z',
    tagsZh: ['动漫绚丽', '星光闪闪', '穿梭推进', '番剧字幕'],
    tagsEn: ['Anime Vivid', 'Star Sparkle', 'Zoom Cut', 'Anime Sub'],
    recipe: {
      transitionType: 'zoomin',
      transitionDurationSec: 0.4,
      alternatingTransitions: ['zoomin', 'hlslice', 'flash', 'hrslice'],
      filterPreset: 'anime-vivid',
      filterIntensity: 95,
      visualEffect: 'gold-sparkle',
      effectIntensity: 72,
      cameraMotions: ['kenBurnsIn', 'panUp', 'kenBurnsOut', 'panRight'],
      tweenIn: 'popIn',
      tweenOut: 'fadeOut',
      adjustments: {
        saturation: 1.18,
        vibrance: 25,
        sharpen: 24
      },
      subtitleStyle: {
        subtitleColor: '#ffffff',
        subtitleBorderColor: '#1e3a8a',
        subtitleBorderWidth: 4,
        subtitleBoxEnabled: false,
        subtitleBoxColor: '#000000',
        subtitleBoxOpacity: 0.5,
        subtitleMotion: 'fade'
      }
    }
  },
  {
    id: 'peach-fashion-lookbook',
    labelZh: '蜜桃穿搭卡点',
    labelEn: 'Fashion Lookbook',
    descZh: '蜜桃乌龙人像调色、灵魂出窍动感残影、左右帷幕与甜酷粉色字幕',
    descEn: 'Peach Oolong portrait LUT, Soul Out ghost zoom, curtain splits and fashion captions',
    badge: 'LOOK',
    accent: '#fb7185',
    previewGradient: 'linear-gradient(135deg, #9f1239 0%, #f43f5e 48%, #fed7aa 100%)',
    iconPath: 'M10 16.5s-6-3.8-6-8.2A3.5 3.5 0 0 1 10 6a3.5 3.5 0 0 1 6 2.3c0 4.4-6 8.2-6 8.2Z',
    tagsZh: ['蜜桃乌龙', '灵魂出窍', '帷幕分割', '穿搭卡点'],
    tagsEn: ['Peach LUT', 'Soul Out', 'Curtain Split', 'Lookbook'],
    recipe: {
      transitionType: 'horzopen',
      transitionDurationSec: 0.4,
      alternatingTransitions: ['horzopen', 'smoothleft', 'vertopen', 'smoothright'],
      filterPreset: 'peach-oolong',
      filterIntensity: 92,
      visualEffect: 'soul-out',
      effectIntensity: 68,
      cameraMotions: ['kenBurnsIn', 'kenBurnsOut', 'panLeft', 'panRight'],
      tweenIn: 'popIn',
      tweenOut: 'fadeOut',
      adjustments: {
        brightness: 0.04,
        vibrance: 18,
        highlights: 12
      },
      subtitleStyle: {
        subtitleColor: '#ffe4e6',
        subtitleBorderColor: '#881337',
        subtitleBorderWidth: 3,
        subtitleBoxEnabled: false,
        subtitleBoxColor: '#000000',
        subtitleBoxOpacity: 0.45,
        subtitleMotion: 'fade'
      }
    }
  },
  {
    id: 'dune-epic-trailer',
    labelZh: '史诗大片预告',
    labelEn: 'Epic Blockbuster Trailer',
    descZh: '沙丘荒漠史诗暖金、宽银幕遮幅、暗场频闪切镜与预告片沉稳字幕',
    descEn: 'Dune desert gold LUT, 2.35:1 scope letterbox, trailer dip-fade cuts and bold titles',
    badge: 'EPIC',
    accent: '#d97706',
    previewGradient: 'linear-gradient(135deg, #292524 0%, #a16207 52%, #fde68a 100%)',
    iconPath: 'M2.5 14c3-3 5.5-3 8.5 0s5 3 6.5 0M2.5 10c3-2.5 5.5-2.5 8.5 0',
    tagsZh: ['沙丘荒漠', '2.35:1 遮幅', '预告暗场', '史诗大片'],
    tagsEn: ['Dune Gold', '2.35:1 Scope', 'Dip to Black', 'Trailer'],
    recipe: {
      transitionType: 'fade',
      transitionDurationSec: 0.55,
      alternatingTransitions: ['fade', 'dissolve', 'flash', 'fade'],
      filterPreset: 'dune-sand',
      filterIntensity: 95,
      visualEffect: 'cinema-letterbox',
      effectIntensity: 90,
      cameraMotions: ['kenBurnsIn', 'panRight', 'kenBurnsOut', 'panLeft'],
      tweenIn: 'fadeIn',
      tweenOut: 'fadeOut',
      adjustments: {
        contrast: 1.18,
        sharpen: 28,
        vignette: 32,
        grain: 15
      },
      subtitleStyle: {
        subtitleColor: '#fef3c7',
        subtitleBorderColor: '#000000',
        subtitleBorderWidth: 4,
        subtitleBoxEnabled: false,
        subtitleBoxColor: '#000000',
        subtitleBoxOpacity: 0.5,
        subtitleMotion: 'fade'
      }
    }
  },
  {
    id: 'vaporwave-party',
    labelZh: '蒸汽波潮流派对',
    labelEn: 'Vaporwave Synth Party',
    descZh: '80年代合成器粉紫蒸汽波、霓虹光晕环绕、挤压对角转场与电光字幕',
    descEn:
      '80s synthwave magenta-cyan LUT, neon halo FX, squeeze/diagonal cuts and retro captions',
    badge: 'SYNTH',
    accent: '#e879f9',
    previewGradient: 'linear-gradient(135deg, #3b0764 0%, #ec4899 52%, #22d3ee 100%)',
    iconPath: 'M3 14h14M6 14a4 4 0 0 1 8 0M3 16.5h14',
    tagsZh: ['蒸汽波紫粉', '霓虹光晕', '挤压转场', '复古电音'],
    tagsEn: ['Vaporwave', 'Neon Halo', 'Squeeze Cut', 'Synthwave'],
    recipe: {
      transitionType: 'squeezeh',
      transitionDurationSec: 0.45,
      alternatingTransitions: ['squeezeh', 'diagtl', 'squeezev', 'diagbr'],
      filterPreset: 'vaporwave',
      filterIntensity: 94,
      visualEffect: 'neon-halo',
      effectIntensity: 78,
      cameraMotions: ['kenBurnsIn', 'panLeft', 'kenBurnsOut', 'panRight'],
      tweenIn: 'popIn',
      tweenOut: 'fadeOut',
      adjustments: {
        saturation: 1.2,
        vibrance: 22,
        tint: 20,
        fade: 8
      },
      subtitleStyle: {
        subtitleColor: '#f0abfc',
        subtitleBorderColor: '#3b0764',
        subtitleBorderWidth: 4,
        subtitleBoxEnabled: true,
        subtitleBoxColor: '#1e1b4b',
        subtitleBoxOpacity: 0.6,
        subtitleMotion: 'fade'
      }
    }
  }
] as const

/** 双语 UI 文案字典（供 ScriptTimelineEditor.vue 直接读取，避免组件内硬编码中文） */
export const TIMELINE_CREATIVE_UI_TEXT = {
  targetCurrentClip: { zh: '当前选中片段', en: 'Selected Clip' },
  scopePerClipHint: {
    zh: '默认仅对当前选中片段生效；点右侧按钮可同步到整条视频轨',
    en: 'Applies only to the selected clip by default; use Apply All to sync whole track'
  },
  targetNoClipHint: {
    zh: '请先在时间线上点击选中一个视频/画面片段，或点击下方「应用到全部片段」',
    en: 'Select a video/overlay clip on the timeline, or click "Apply to All Clips" below'
  },
  applyToAllClips: { zh: '应用到全部视频片段', en: 'Apply to All Video Clips' },
  resetCurrentClip: { zh: '重置当前', en: 'Reset Clip' },
  resetAllClips: { zh: '全部重置', en: 'Reset All' },
  clearAllEffects: { zh: '清除全轨特效', en: 'Clear All Effects' },
  clearAllFilters: { zh: '清除全轨滤镜', en: 'Clear All Filters' },
  effectIntensityLabel: { zh: '特效强度', en: 'FX Intensity' },
  filterIntensityLabel: { zh: '滤镜强度', en: 'Filter Intensity' },
  transitionDurationLabel: { zh: '转场时长', en: 'Duration' },
  targetCutPairLabel: { zh: '当前切点', en: 'Active Cut' },
  previewTransitionBtn: { zh: '▶ 预览转场', en: '▶ Preview Cut' },
  needTwoClipsForTransition: {
    zh: '需至少 2 个视频片段才可添加转场（可先添加素材或分割片段）',
    en: 'At least 2 video clips are required for transitions (add media or split a clip)'
  },
  applyTransitionCurrent: { zh: '应用到当前片段切点', en: 'Apply to Selected Cut' },
  applyTransitionAll: { zh: '应用到全部切点', en: 'Apply to All Cuts' },
  clearAllTransitions: { zh: '清除全部转场', en: 'Clear All Transitions' },
  applyTemplateBtn: { zh: '一键套用此模板', en: 'Apply Template' },
  templateEmptyAutoFillHint: {
    zh: '若主视频轨为空，将自动把左侧视频素材按顺序铺满时间线并套用整套包装',
    en: 'If the video track is empty, media sources will be placed automatically before styling'
  },
  appliedEffectToast: { zh: '已应用画面特效：', en: 'Applied visual effect: ' },
  appliedEffectAllToast: {
    zh: '已将特效同步到全部视频片段：',
    en: 'Applied effect to all video clips: '
  },
  appliedFilterToast: { zh: '已应用滤镜：', en: 'Applied filter: ' },
  appliedFilterAllToast: {
    zh: '已将滤镜同步到全部视频片段：',
    en: 'Applied filter to all video clips: '
  },
  appliedAdjustmentAllToast: {
    zh: '已将当前调色参数同步到全部视频片段',
    en: 'Synced color adjustments to all video clips'
  },
  resetAdjustmentToast: {
    zh: '已重置片段调色与滤镜参数',
    en: 'Reset clip color adjustments and filter'
  },
  appliedTemplateToast: {
    zh: '已套用剪辑模板：',
    en: 'Applied creative template: '
  },
  noVideoClipsWarning: {
    zh: '时间线上暂无视频片段，请先添加素材到视频轨',
    en: 'No video clips on the timeline yet. Add media to the video track first.'
  }
} as const

export function getTimelineFilterPresetMeta(id?: string | null): TimelineFilterPresetMeta {
  if (!id || id === 'none') return TIMELINE_FILTER_PRESETS[0]
  return TIMELINE_FILTER_PRESETS.find((item) => item.id === id) ?? TIMELINE_FILTER_PRESETS[0]
}

export function getTimelineVisualEffectMeta(id?: string | null): TimelineVisualEffectMeta {
  if (!id || id === 'none') return TIMELINE_VISUAL_EFFECTS[0]
  return TIMELINE_VISUAL_EFFECTS.find((item) => item.id === id) ?? TIMELINE_VISUAL_EFFECTS[0]
}

export function clampRange(val: unknown, min: number, max: number, fallback: number): number {
  const n = typeof val === 'number' ? val : Number(val)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export function hasClipCreativeAdjustments(
  clip?: Partial<TimelineClipCreativeProps> | null
): boolean {
  if (!clip) return false
  if (clip.filterPreset && clip.filterPreset !== 'none') return true
  if (clip.visualEffect && clip.visualEffect !== 'none') return true
  if (Math.abs((clip.brightness ?? 0) - 0) > 0.005) return true
  if (Math.abs((clip.contrast ?? 1) - 1) > 0.01) return true
  if (Math.abs((clip.saturation ?? 1) - 1) > 0.01) return true
  if (Math.abs(clip.vibrance ?? 0) >= 1) return true
  if (Math.abs(clip.temperature ?? 0) >= 1) return true
  if (Math.abs(clip.tint ?? 0) >= 1) return true
  if (Math.abs(clip.highlights ?? 0) >= 1) return true
  if (Math.abs(clip.shadows ?? 0) >= 1) return true
  if ((clip.sharpen ?? 0) >= 1) return true
  if ((clip.vignette ?? 0) >= 1) return true
  if ((clip.fade ?? 0) >= 1) return true
  if ((clip.grain ?? 0) >= 1) return true
  return false
}

/**
 * 计算预览播放器 60fps 实时 CSS filter 字符串（综合调节 + 滤镜预设 + 31款画面特效）
 */
export function buildClipVisualCssFilter(
  clip?: Partial<TimelineClipCreativeProps> | null,
  localTimeSec = 0
): string | undefined {
  if (!clip) return undefined
  const filterMeta = getTimelineFilterPresetMeta(clip.filterPreset)
  const filterScale =
    filterMeta.id === 'none' ? 0 : clampRange(clip.filterIntensity, 0, 100, 100) / 100

  const effectMeta = getTimelineVisualEffectMeta(clip.visualEffect)
  const effectScale =
    effectMeta.id === 'none' ? 0 : clampRange(clip.effectIntensity, 0, 100, 75) / 100

  const userBrightness = clampRange(clip.brightness, -0.5, 0.5, 0)
  const userContrast = clampRange(clip.contrast, 0.5, 2, 1)
  const userSaturation = clampRange(clip.saturation, 0, 3, 1)
  const userVibrance = clampRange(clip.vibrance, -100, 100, 0)
  const userTemp = clampRange(clip.temperature, -100, 100, 0)
  const userTint = clampRange(clip.tint, -100, 100, 0)
  const userHighlights = clampRange(clip.highlights, -100, 100, 0)
  const userShadows = clampRange(clip.shadows, -100, 100, 0)
  const userSharpen = clampRange(clip.sharpen, 0, 100, 0)
  const userFade = clampRange(clip.fade, 0, 100, 0)

  let brightness =
    1 +
    userBrightness +
    filterMeta.recipe.brightness * filterScale +
    (userHighlights * 0.0012 + userShadows * 0.0015) +
    (userFade + filterMeta.recipe.fade * filterScale) * 0.0008

  let contrast =
    userContrast *
    (1 + (filterMeta.recipe.contrast - 1) * filterScale) *
    (1 + (userHighlights - userShadows) * 0.0012) *
    (1 - (userFade + filterMeta.recipe.fade * filterScale) * 0.0018) *
    (1 + userSharpen * 0.0012)

  let saturation =
    userSaturation *
    (1 + (userVibrance / 100) * 0.42) *
    (1 + (filterMeta.recipe.saturation - 1) * filterScale) *
    (1 - (userFade + filterMeta.recipe.fade * filterScale) * 0.0015)

  const totalTemp = userTemp + filterMeta.recipe.temperature * filterScale
  const totalTint = userTint + filterMeta.recipe.tint * filterScale

  let sepia = filterMeta.recipe.sepia * filterScale + (totalTemp > 0 ? (totalTemp / 100) * 0.24 : 0)

  let hueRotateDeg =
    filterMeta.recipe.hueRotateDeg * filterScale +
    (totalTemp < 0 ? (totalTemp / 100) * 14 : -(totalTemp / 100) * 4) +
    (totalTint / 100) * 18

  let blurPx = 0
  let invertRatio = 0
  const extraShadows: string[] = []

  const t = Math.max(0, Number.isFinite(localTimeSec) ? localTimeSec : 0)
  // 赋予非零初相位，确保播放头静止在 localTimeSec=0 时动态特效也有立即可见的视觉反馈
  const phase = t + 0.42

  switch (effectMeta.id) {
    case 'rgb-glitch': {
      const shiftPx = Number(
        (Math.max(2.2, 5.5 * effectScale) * (0.72 + 0.28 * Math.sin(phase * 19))).toFixed(2)
      )
      extraShadows.push(
        `drop-shadow(${shiftPx}px 0 0 rgba(255, 0, 85, ${(0.68 * effectScale).toFixed(2)}))`,
        `drop-shadow(${-shiftPx}px 0 0 rgba(0, 240, 255, ${(0.68 * effectScale).toFixed(2)}))`
      )
      contrast *= 1 + 0.16 * effectScale
      saturation *= 1 + 0.22 * effectScale
      break
    }
    case 'bad-tv': {
      const wave = Math.sin(phase * 31)
      const shiftPx = Number(((Math.abs(wave) < 0.25 ? 0.6 : wave) * 4.6 * effectScale).toFixed(2))
      extraShadows.push(
        `drop-shadow(${shiftPx}px 0 0 rgba(0, 230, 255, ${(0.62 * effectScale).toFixed(2)}))`,
        `drop-shadow(${-shiftPx * 0.7}px 1px 0 rgba(244, 63, 94, ${(0.48 * effectScale).toFixed(2)}))`
      )
      contrast *= 1 + 0.22 * effectScale
      saturation *= 1 - 0.18 * effectScale
      break
    }
    case 'neon-edge': {
      hueRotateDeg += (28 + t * 75 * effectScale) % 360
      saturation *= 1 + 0.55 * effectScale
      contrast *= 1 + 0.26 * effectScale
      extraShadows.push(
        `drop-shadow(0 0 ${Math.round(12 * effectScale)}px rgba(192, 132, 252, ${(0.65 * effectScale).toFixed(2)}))`
      )
      break
    }
    case 'cyber-matrix': {
      hueRotateDeg += 78 * effectScale
      saturation *= 1 + 0.32 * effectScale
      contrast *= 1 + 0.28 * effectScale
      brightness -= 0.04 * effectScale
      break
    }
    case 'pixel-mosaic': {
      contrast *= 1 + 0.34 * effectScale
      saturation *= 1 + 0.26 * effectScale
      blurPx += Number((1.4 * effectScale).toFixed(2))
      break
    }
    case 'earthquake': {
      const shiftPx = Number((4.2 * effectScale * Math.cos(phase * 43)).toFixed(2))
      extraShadows.push(
        `drop-shadow(0 ${shiftPx}px 0 rgba(239, 68, 68, ${(0.58 * effectScale).toFixed(2)}))`,
        `drop-shadow(${shiftPx * 0.6}px 0 0 rgba(56, 189, 248, ${(0.45 * effectScale).toFixed(2)}))`
      )
      contrast *= 1 + 0.18 * effectScale
      break
    }
    case 'beat-pulse': {
      const beatWave = Math.pow(Math.max(0.35, Math.abs(Math.sin(phase * Math.PI * 2.2))), 2)
      brightness += beatWave * 0.18 * effectScale
      contrast *= 1 + beatWave * 0.16 * effectScale
      saturation *= 1 + beatWave * 0.22 * effectScale
      break
    }
    case 'soul-out': {
      const soulWave = 0.35 + 0.65 * ((Math.sin(phase * Math.PI * 2.4) + 1) * 0.5)
      const spreadPx = Number((soulWave * 14 * effectScale).toFixed(1))
      extraShadows.push(
        `drop-shadow(0 0 ${spreadPx}px rgba(244, 114, 182, ${(0.68 * effectScale).toFixed(2)}))`
      )
      brightness += soulWave * 0.14 * effectScale
      contrast *= 1 + 0.12 * effectScale
      break
    }
    case 'strobe-flash': {
      const flashWave = Math.sin(phase * Math.PI * 7) > 0.15 ? 1 : 0.2
      brightness += flashWave * 0.3 * effectScale
      contrast *= 1 + flashWave * 0.24 * effectScale
      break
    }
    case 'zoom-burst': {
      const burstCycle = t > 0.01 ? t % 1.2 : 0.18
      const burstFactor = Math.max(0.28, 1 - burstCycle / 0.75)
      brightness += burstFactor * 0.16 * effectScale
      contrast *= 1 + burstFactor * 0.2 * effectScale
      break
    }
    case 'dreamy-bloom': {
      brightness += 0.07 * effectScale
      contrast *= 1 - 0.06 * effectScale
      saturation *= 1 + 0.14 * effectScale
      extraShadows.push(
        `drop-shadow(0 0 ${Math.round(16 * effectScale)}px rgba(255, 210, 240, ${(0.55 * effectScale).toFixed(2)}))`
      )
      break
    }
    case 'gold-sparkle': {
      const twinkle = 0.55 + 0.45 * Math.sin(phase * 14)
      brightness += 0.08 * twinkle * effectScale
      contrast *= 1 + 0.1 * effectScale
      sepia += 0.15 * effectScale
      extraShadows.push(
        `drop-shadow(0 0 ${Math.round(12 * effectScale)}px rgba(251, 191, 36, ${(0.58 * twinkle * effectScale).toFixed(2)}))`
      )
      break
    }
    case 'sunset-leak': {
      brightness += 0.05 * effectScale
      sepia += 0.26 * effectScale
      hueRotateDeg -= 10 * effectScale
      saturation *= 1 + 0.24 * effectScale
      break
    }
    case 'neon-halo': {
      saturation *= 1 + 0.28 * effectScale
      contrast *= 1 + 0.15 * effectScale
      break
    }
    case 'blur-focus': {
      const focusCycle = t > 0.01 ? Math.max(0, 1 - (t % 2.0) / 1.35) : 0.65
      blurPx += Number((focusCycle * 9 * effectScale).toFixed(2))
      break
    }
    case 'tilt-shift': {
      contrast *= 1 + 0.16 * effectScale
      saturation *= 1 + 0.26 * effectScale
      break
    }
    case 'vhs-retro': {
      contrast *= 1.1
      saturation *= 0.86
      sepia += 0.16 * effectScale
      hueRotateDeg += Math.sin(phase * 6) * 5 * effectScale
      const vhsShift = Number((2.8 * effectScale).toFixed(2))
      extraShadows.push(
        `drop-shadow(${vhsShift}px 0 0 rgba(255, 40, 100, ${(0.52 * effectScale).toFixed(2)}))`,
        `drop-shadow(${-vhsShift}px 0 0 rgba(0, 220, 255, ${(0.52 * effectScale).toFixed(2)}))`
      )
      break
    }
    case 'old-film': {
      const flicker = 0.04 * Math.sin(phase * 27) * effectScale
      brightness += flicker
      sepia = Math.min(1, sepia + 0.62 * effectScale)
      contrast *= 1 + 0.16 * effectScale
      saturation *= Math.max(0.22, 1 - 0.38 * effectScale)
      break
    }
    case 'dv-cam': {
      contrast *= 1 + 0.1 * effectScale
      saturation *= 0.9
      break
    }
    case 'posterize-pop': {
      contrast *= 1 + 0.62 * effectScale
      saturation *= 1 + 0.72 * effectScale
      break
    }
    case 'cinema-letterbox': {
      contrast *= 1 + 0.12 * effectScale
      break
    }
    case 'bw-spotlight': {
      saturation *= Math.max(0, 1 - 0.96 * effectScale)
      contrast *= 1 + 0.32 * effectScale
      brightness -= 0.03 * effectScale
      break
    }
    case 'thermal-vision': {
      invertRatio = Math.min(0.88, 0.78 * effectScale)
      hueRotateDeg += 165 * effectScale
      saturation *= 1 + 0.85 * effectScale
      contrast *= 1 + 0.38 * effectScale
      break
    }
    case 'night-vision': {
      sepia = Math.min(1, sepia + 0.88 * effectScale)
      hueRotateDeg += 72 * effectScale
      saturation *= 1 + 0.6 * effectScale
      contrast *= 1 + 0.3 * effectScale
      break
    }
    case 'negative-invert': {
      invertRatio = Math.min(1, Math.max(0, effectScale))
      break
    }
    default:
      break
  }

  brightness = clampRange(brightness, 0.2, 2.2, 1)
  contrast = clampRange(contrast, 0.3, 2.8, 1)
  saturation = clampRange(saturation, 0, 3.4, 1)
  sepia = clampRange(sepia, 0, 1, 0)

  const parts: string[] = []
  if (Math.abs(brightness - 1) > 0.005) parts.push(`brightness(${brightness.toFixed(3)})`)
  if (Math.abs(contrast - 1) > 0.005) parts.push(`contrast(${contrast.toFixed(3)})`)
  if (Math.abs(saturation - 1) > 0.005) parts.push(`saturate(${saturation.toFixed(3)})`)
  if (sepia > 0.005) parts.push(`sepia(${sepia.toFixed(3)})`)
  if (Math.abs(hueRotateDeg) > 0.2) parts.push(`hue-rotate(${hueRotateDeg.toFixed(1)}deg)`)
  if (blurPx > 0.05) parts.push(`blur(${blurPx.toFixed(2)}px)`)
  if (invertRatio > 0.01) parts.push(`invert(${invertRatio.toFixed(2)})`)
  if (extraShadows.length > 0) parts.push(...extraShadows)

  return parts.length > 0 ? parts.join(' ') : undefined
}

const DYNAMIC_VISUAL_EFFECT_IDS = new Set<TimelineVisualEffectId>([
  'rgb-glitch',
  'bad-tv',
  'neon-edge',
  'camera-shake',
  'earthquake',
  'beat-pulse',
  'soul-out',
  'strobe-flash',
  'pendulum-swing',
  'zoom-burst',
  'gold-sparkle',
  'blur-focus',
  'vhs-retro',
  'old-film'
])

/**
 * 判断特效是否为随时间脉动的动态特效（供预览舞台在暂停时也驱动 60fps 预览时钟）
 */
export function isDynamicVisualEffect(effectId?: string | null): boolean {
  if (!effectId || effectId === 'none') return false
  return DYNAMIC_VISUAL_EFFECT_IDS.has(effectId as TimelineVisualEffectId)
}

/**
 * 计算预览播放器 60fps 画面运动特效附加 CSS transform
 */
export function buildClipVisualCssTransform(
  clip?: Partial<TimelineClipCreativeProps> | null,
  localTimeSec = 0
): string | undefined {
  if (!clip || !clip.visualEffect || clip.visualEffect === 'none') return undefined
  const effectScale = clampRange(clip.effectIntensity, 0, 100, 75) / 100
  if (effectScale <= 0.01) return undefined
  const t = Math.max(0, Number.isFinite(localTimeSec) ? localTimeSec : 0)
  // 初相位避免 t=0 时正弦波为 0 导致静态帧无视觉变化
  const phase = t + 0.38

  switch (clip.visualEffect) {
    case 'camera-shake': {
      const dx = (Math.sin(phase * 37) * 0.65 + Math.cos(phase * 53) * 0.35) * 2.1 * effectScale
      const dy = (Math.cos(phase * 41) * 0.6 + Math.sin(phase * 61) * 0.4) * 1.7 * effectScale
      const rot = Math.sin(phase * 29) * 1.1 * effectScale
      const scale = 1 + 0.055 * effectScale
      return `translate(${dx.toFixed(2)}%, ${dy.toFixed(2)}%) rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(3)})`
    }
    case 'earthquake': {
      const dx = Math.sin(phase * 55) * 1.5 * effectScale
      const dy = Math.cos(phase * 63) * 3.6 * effectScale
      const scale = 1 + 0.075 * effectScale
      return `translate(${dx.toFixed(2)}%, ${dy.toFixed(2)}%) scale(${scale.toFixed(3)})`
    }
    case 'beat-pulse': {
      const beatWave = Math.pow(Math.max(0.38, Math.abs(Math.sin(phase * Math.PI * 2.2))), 2)
      const scale = 1 + beatWave * 0.08 * effectScale
      return `scale(${scale.toFixed(3)})`
    }
    case 'soul-out': {
      const soulWave = Math.pow(Math.max(0.35, Math.abs(Math.sin(phase * Math.PI * 2.0))), 2)
      const scale = 1 + soulWave * 0.095 * effectScale
      return `scale(${scale.toFixed(3)})`
    }
    case 'pendulum-swing': {
      const rot = Math.sin(phase * Math.PI * 1.6) * 3.0 * effectScale
      const dx = Math.cos(phase * Math.PI * 1.6) * 1.6 * effectScale
      const scale = 1 + 0.055 * effectScale
      return `translateX(${dx.toFixed(2)}%) rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(3)})`
    }
    case 'zoom-burst': {
      const burstCycle = t > 0.01 ? t % 1.2 : 0.15
      const burstFactor = Math.pow(Math.max(0.28, 1 - burstCycle / 0.75), 2)
      const scale = 1 + burstFactor * 0.26 * effectScale
      return `scale(${scale.toFixed(3)})`
    }
    case 'rgb-glitch':
    case 'bad-tv': {
      const wave = Math.sin(phase * 23)
      const glitchBurst =
        Math.abs(wave) > 0.45
          ? Math.cos(phase * 67) * 1.25 * effectScale
          : 0.42 * effectScale * (wave >= 0 ? 1 : -1)
      return `translateX(${glitchBurst.toFixed(2)}%) scale(1.018)`
    }
    default:
      return undefined
  }
}

export interface ClipVisualSvgFilterMeta {
  /** 是否需要启用硬件加速 SVG 滤镜 */
  enabled: boolean
  /** 4x5 feColorMatrix 矩阵 (20 个浮点数)，精确复现 colorBalance (rs/gs/bs, rm/gm/bm, rh/gh/bh) + fade + 色温色调 */
  colorMatrixValues: string
  /** RGB 通道分离横向像素偏移 (>0 时开启真实红绿蓝三通道分离合成) */
  rgbShiftPx: number
  /** RGB 通道分离纵向像素偏移 */
  rgbShiftVerticalPx: number
  /** 3x3 卷积锐化强度 (0 表示不启用) */
  sharpenAmount: number
  /** 3x3 feConvolveMatrix kernelMatrix 字符串 */
  sharpenKernel: string
  /** 波普色调分离离散阶数表 (null 表示不启用) */
  posterizeTable: string | null
  /** 像素马赛克膨胀半径 (0 表示不启用) */
  mosaicRadius: number
}

const IDENTITY_COLOR_MATRIX = '1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0'

/**
 * 计算预览播放器内联 SVG 硬件加速滤镜参数（色彩平衡矩阵 / RGB 通道分离 / 卷积锐化 / 色调分离 / 像素马赛克）
 */
export function buildClipVisualSvgFilterMeta(
  clip?: Partial<TimelineClipCreativeProps> | null,
  localTimeSec = 0
): ClipVisualSvgFilterMeta {
  if (!clip) {
    return {
      enabled: false,
      colorMatrixValues: IDENTITY_COLOR_MATRIX,
      rgbShiftPx: 0,
      rgbShiftVerticalPx: 0,
      sharpenAmount: 0,
      sharpenKernel: '0 0 0 0 1 0 0 0 0',
      posterizeTable: null,
      mosaicRadius: 0
    }
  }
  const filterMeta = getTimelineFilterPresetMeta(clip.filterPreset)
  const filterScale =
    filterMeta.id === 'none' ? 0 : clampRange(clip.filterIntensity, 0, 100, 100) / 100
  const effectMeta = getTimelineVisualEffectMeta(clip.visualEffect)
  const effectScale =
    effectMeta.id === 'none' ? 0 : clampRange(clip.effectIntensity, 0, 100, 75) / 100

  const userTemp = clampRange(clip.temperature, -100, 100, 0)
  const userTint = clampRange(clip.tint, -100, 100, 0)
  const userHighlights = clampRange(clip.highlights, -100, 100, 0)
  const userShadows = clampRange(clip.shadows, -100, 100, 0)
  const userSharpen = clampRange(clip.sharpen, 0, 100, 0)
  const userFade = clampRange(clip.fade, 0, 100, 0)

  const totalFade = userFade + filterMeta.recipe.fade * filterScale
  const totalTemp =
    userTemp +
    filterMeta.recipe.temperature * filterScale +
    (effectMeta.id === 'sunset-leak' ? 28 * effectScale : 0)
  const totalTint =
    userTint +
    filterMeta.recipe.tint * filterScale +
    (effectMeta.id === 'cyber-matrix' || effectMeta.id === 'night-vision' ? -36 * effectScale : 0)

  const fb = filterMeta.recipe.colorBalance
  const rs = clampRange(
    (fb?.rs ?? 0) * filterScale + (totalTemp / 100) * 0.14 + (userShadows / 100) * 0.06,
    -0.5,
    0.5,
    0
  )
  const gs = clampRange(
    (fb?.gs ?? 0) * filterScale - (totalTint / 100) * 0.12 + (userShadows / 100) * 0.06,
    -0.5,
    0.5,
    0
  )
  const bs = clampRange(
    (fb?.bs ?? 0) * filterScale - (totalTemp / 100) * 0.16 + (userShadows / 100) * 0.06,
    -0.5,
    0.5,
    0
  )
  const rm = clampRange(
    (fb?.rm ?? 0) * filterScale + (totalTemp / 100) * 0.18 + (totalTint / 100) * 0.08,
    -0.5,
    0.5,
    0
  )
  const gm = clampRange((fb?.gm ?? 0) * filterScale - (totalTint / 100) * 0.14, -0.5, 0.5, 0)
  const bm = clampRange(
    (fb?.bm ?? 0) * filterScale - (totalTemp / 100) * 0.18 + (totalTint / 100) * 0.06,
    -0.5,
    0.5,
    0
  )
  const rh = clampRange(
    (fb?.rh ?? 0) * filterScale + (totalTemp / 100) * 0.16 + (userHighlights / 100) * 0.1,
    -0.5,
    0.5,
    0
  )
  const gh = clampRange(
    (fb?.gh ?? 0) * filterScale - (totalTint / 100) * 0.1 + (userHighlights / 100) * 0.1,
    -0.5,
    0.5,
    0
  )
  const bh = clampRange(
    (fb?.bh ?? 0) * filterScale - (totalTemp / 100) * 0.16 + (userHighlights / 100) * 0.1,
    -0.5,
    0.5,
    0
  )

  const fadeLift = clampRange((totalFade / 100) * 0.1, 0, 0.15, 0)
  const hasColorBalance =
    Math.abs(rs) > 0.008 ||
    Math.abs(gs) > 0.008 ||
    Math.abs(bs) > 0.008 ||
    Math.abs(rm) > 0.008 ||
    Math.abs(gm) > 0.008 ||
    Math.abs(bm) > 0.008 ||
    Math.abs(rh) > 0.008 ||
    Math.abs(gh) > 0.008 ||
    Math.abs(bh) > 0.008 ||
    fadeLift > 0.005

  let colorMatrixValues = IDENTITY_COLOR_MATRIX
  if (hasColorBalance) {
    const rr = (1 + rm * 0.36 + rh * 0.44 - rs * 0.14) * (1 - fadeLift * 0.65)
    const rg = (rh - rs) * 0.08
    const rb = (rm - bs) * 0.06
    const rOff = rs * 0.22 + rm * 0.08 + fadeLift

    const gr = (gh - gs) * 0.06
    const gg = (1 + gm * 0.36 + gh * 0.44 - gs * 0.14) * (1 - fadeLift * 0.65)
    const gb = (gm - bs) * 0.06
    const gOff = gs * 0.22 + gm * 0.08 + fadeLift

    const br = (bh - rs) * 0.06
    const bg = (bm - gs) * 0.08
    const bb = (1 + bm * 0.36 + bh * 0.44 - bs * 0.14) * (1 - fadeLift * 0.65)
    const bOff = bs * 0.22 + bm * 0.08 + fadeLift

    colorMatrixValues = [
      rr.toFixed(3),
      rg.toFixed(3),
      rb.toFixed(3),
      '0',
      rOff.toFixed(3),
      gr.toFixed(3),
      gg.toFixed(3),
      gb.toFixed(3),
      '0',
      gOff.toFixed(3),
      br.toFixed(3),
      bg.toFixed(3),
      bb.toFixed(3),
      '0',
      bOff.toFixed(3),
      '0',
      '0',
      '0',
      '1',
      '0'
    ].join(' ')
  }

  const t = Math.max(0, Number.isFinite(localTimeSec) ? localTimeSec : 0)
  const phase = t + 0.42

  let rgbShiftPx = 0
  let rgbShiftVerticalPx = 0
  if (effectMeta.id === 'rgb-glitch') {
    rgbShiftPx = Number(
      (Math.max(2.5, 6.8 * effectScale) * (0.7 + 0.3 * Math.sin(phase * 19))).toFixed(2)
    )
    rgbShiftVerticalPx = Number((1.4 * effectScale * Math.cos(phase * 23)).toFixed(2))
  } else if (effectMeta.id === 'bad-tv') {
    rgbShiftPx = Number(
      (Math.max(2.0, 5.2 * effectScale) * (0.65 + 0.35 * Math.sin(phase * 31))).toFixed(2)
    )
    rgbShiftVerticalPx = Number((1.0 * effectScale).toFixed(2))
  } else if (effectMeta.id === 'vhs-retro') {
    rgbShiftPx = Number((3.4 * effectScale).toFixed(2))
    rgbShiftVerticalPx = Number((0.8 * effectScale).toFixed(2))
  } else if (effectMeta.id === 'earthquake') {
    rgbShiftPx = Number((3.2 * effectScale * Math.abs(Math.cos(phase * 37))).toFixed(2))
    rgbShiftVerticalPx = Number((2.4 * effectScale * Math.sin(phase * 43)).toFixed(2))
  } else if (effectMeta.id === 'soul-out') {
    rgbShiftPx = Number((2.6 * effectScale).toFixed(2))
  }

  const effectiveSharpen = Math.max(
    userSharpen,
    effectMeta.id === 'camera-shake' || effectMeta.id === 'earthquake' ? 18 * effectScale : 0,
    effectMeta.id === 'dv-cam' || effectMeta.id === 'pendulum-swing' ? 16 * effectScale : 0
  )
  const sharpenAmount =
    effectiveSharpen >= 3 ? Number(((effectiveSharpen / 100) * 1.15).toFixed(3)) : 0
  const centerWeight = Number((1 + 4 * sharpenAmount).toFixed(3))
  const neighborWeight = Number((-sharpenAmount).toFixed(3))
  const sharpenKernel =
    sharpenAmount > 0
      ? `0 ${neighborWeight} 0 ${neighborWeight} ${centerWeight} ${neighborWeight} 0 ${neighborWeight} 0`
      : '0 0 0 0 1 0 0 0 0'

  const posterizeTable =
    effectMeta.id === 'posterize-pop' && effectScale > 0.1
      ? effectScale > 0.65
        ? '0 0.33 0.67 1'
        : '0 0.25 0.5 0.75 1'
      : null

  const mosaicRadius =
    effectMeta.id === 'pixel-mosaic' && effectScale > 0.1
      ? Number(Math.max(1.5, 4.2 * effectScale).toFixed(1))
      : 0

  const enabled =
    hasColorBalance ||
    rgbShiftPx > 0.2 ||
    sharpenAmount > 0.02 ||
    posterizeTable !== null ||
    mosaicRadius > 0

  return {
    enabled,
    colorMatrixValues,
    rgbShiftPx,
    rgbShiftVerticalPx,
    sharpenAmount,
    sharpenKernel,
    posterizeTable,
    mosaicRadius
  }
}

export interface ClipVisualOverlayMeta {
  hasOverlay: boolean
  vignetteOpacity: number
  letterboxRatio: number
  scanlinesOpacity: number
  grainOpacity: number
  bloomOpacity: number
  lightLeakOpacity: number
  neonHaloOpacity: number
  dvCamOverlay: boolean
  splitMode: 'none' | 'split-2h' | 'split-3v' | 'split-4grid'
  /** 灵魂出窍残影克隆层透明度 (0..0.65) */
  soulOutOpacity: number
  /** 灵魂出窍残影克隆层缩放倍率 (1.06..1.38) */
  soulOutScale: number
  /** 频闪卡点高光层透明度 (0..0.55) */
  strobeFlashOpacity: number
  /** 移轴微缩上下景深模糊半径 (px) */
  tiltShiftBlurPx: number
  /** 星光闪闪金粉芒星透明度 (0..0.85) */
  sparkleOpacity: number
  /** 故障撕裂扫描条透明度 (0..0.75) */
  glitchSliceOpacity: number
  /** 是否为随时间动态变化的特效 */
  isDynamicEffect: boolean
}

/**
 * 计算预览舞台叠加层状态（暗角 / 宽银幕黑边 / 扫描线 / 颗粒 / 柔光 / 漏光 / 霓虹光晕 / DV 框 / 分屏网格 / 灵魂出窍残影 / 移轴 / 频闪 / 星芒）
 */
export function buildClipVisualOverlayMeta(
  clip?: Partial<TimelineClipCreativeProps> | null,
  localTimeSec = 0
): ClipVisualOverlayMeta {
  if (!clip) {
    return {
      hasOverlay: false,
      vignetteOpacity: 0,
      letterboxRatio: 0,
      scanlinesOpacity: 0,
      grainOpacity: 0,
      bloomOpacity: 0,
      lightLeakOpacity: 0,
      neonHaloOpacity: 0,
      dvCamOverlay: false,
      splitMode: 'none',
      soulOutOpacity: 0,
      soulOutScale: 1,
      strobeFlashOpacity: 0,
      tiltShiftBlurPx: 0,
      sparkleOpacity: 0,
      glitchSliceOpacity: 0,
      isDynamicEffect: false
    }
  }
  const filterMeta = getTimelineFilterPresetMeta(clip.filterPreset)
  const filterScale =
    filterMeta.id === 'none' ? 0 : clampRange(clip.filterIntensity, 0, 100, 100) / 100
  const effectMeta = getTimelineVisualEffectMeta(clip.visualEffect)
  const effectScale =
    effectMeta.id === 'none' ? 0 : clampRange(clip.effectIntensity, 0, 100, 75) / 100

  const t = Math.max(0, Number.isFinite(localTimeSec) ? localTimeSec : 0)
  const phase = t + 0.42

  const userVignette = clampRange(clip.vignette, 0, 100, 0) / 100
  const filterVignette = (filterMeta.recipe.vignette / 100) * filterScale
  const effectVignette =
    effectMeta.id === 'bw-spotlight'
      ? 0.72 * effectScale
      : effectMeta.id === 'old-film' || effectMeta.id === 'night-vision'
        ? 0.52 * effectScale
        : effectMeta.id === 'vhs-retro' || effectMeta.id === 'tilt-shift'
          ? 0.35 * effectScale
          : 0

  const vignetteOpacity = Math.min(0.92, Math.max(userVignette, filterVignette, effectVignette))
  const letterboxRatio =
    effectMeta.id === 'cinema-letterbox'
      ? Number((0.12 * Math.max(0.5, effectScale)).toFixed(3))
      : 0
  const scanlinesOpacity =
    effectMeta.id === 'vhs-retro' || effectMeta.id === 'bad-tv' || effectMeta.id === 'cyber-matrix'
      ? Number((0.54 * effectScale).toFixed(2))
      : 0

  const userGrain = clampRange(clip.grain, 0, 100, 0) / 100
  const effectGrain =
    effectMeta.id === 'old-film' || effectMeta.id === 'night-vision'
      ? 0.46 * effectScale
      : effectMeta.id === 'vhs-retro' || effectMeta.id === 'bad-tv'
        ? 0.38 * effectScale
        : 0
  const grainOpacity = Math.min(0.78, Math.max(userGrain * 0.68, effectGrain))
  const bloomOpacity =
    effectMeta.id === 'dreamy-bloom' ||
    effectMeta.id === 'gold-sparkle' ||
    effectMeta.id === 'soul-out'
      ? Number((0.44 * effectScale).toFixed(2))
      : 0
  const lightLeakOpacity =
    effectMeta.id === 'sunset-leak' ? Number((0.62 * effectScale).toFixed(2)) : 0
  const neonHaloOpacity =
    effectMeta.id === 'neon-halo' || effectMeta.id === 'neon-edge'
      ? Number((0.62 * effectScale).toFixed(2))
      : 0
  const dvCamOverlay = effectMeta.id === 'dv-cam' && effectScale > 0.1
  const splitMode: ClipVisualOverlayMeta['splitMode'] =
    effectMeta.id === 'split-2h' || effectMeta.id === 'split-3v' || effectMeta.id === 'split-4grid'
      ? effectMeta.id
      : 'none'

  let soulOutOpacity = 0
  let soulOutScale = 1
  if (effectMeta.id === 'soul-out' && effectScale > 0.05) {
    const cycle = (phase * 1.45) % 1
    soulOutScale = Number((1.06 + cycle * 0.32 * effectScale).toFixed(3))
    soulOutOpacity = Number(((1 - cycle * 0.72) * 0.54 * effectScale).toFixed(2))
  }

  const strobeFlashOpacity =
    effectMeta.id === 'strobe-flash' && effectScale > 0.05
      ? Number(((Math.sin(phase * Math.PI * 7) > 0.15 ? 0.46 : 0.08) * effectScale).toFixed(2))
      : 0

  const tiltShiftBlurPx =
    effectMeta.id === 'tilt-shift' && effectScale > 0.05
      ? Number((7.5 * effectScale).toFixed(1))
      : 0

  const sparkleOpacity =
    effectMeta.id === 'gold-sparkle' && effectScale > 0.05
      ? Number(((0.55 + 0.45 * Math.sin(phase * 12)) * 0.78 * effectScale).toFixed(2))
      : 0

  const glitchSliceOpacity =
    (effectMeta.id === 'rgb-glitch' || effectMeta.id === 'bad-tv') && effectScale > 0.05
      ? Number((0.62 * effectScale).toFixed(2))
      : 0

  const isDynamicEffect = isDynamicVisualEffect(effectMeta.id)

  const hasOverlay =
    vignetteOpacity > 0.02 ||
    letterboxRatio > 0.01 ||
    scanlinesOpacity > 0.02 ||
    grainOpacity > 0.02 ||
    bloomOpacity > 0.02 ||
    lightLeakOpacity > 0.02 ||
    neonHaloOpacity > 0.02 ||
    dvCamOverlay ||
    splitMode !== 'none' ||
    soulOutOpacity > 0.02 ||
    strobeFlashOpacity > 0.02 ||
    tiltShiftBlurPx > 0.2 ||
    sparkleOpacity > 0.02 ||
    glitchSliceOpacity > 0.02

  return {
    hasOverlay,
    vignetteOpacity,
    letterboxRatio,
    scanlinesOpacity,
    grainOpacity,
    bloomOpacity,
    lightLeakOpacity,
    neonHaloOpacity,
    dvCamOverlay,
    splitMode,
    soulOutOpacity,
    soulOutScale,
    strobeFlashOpacity,
    tiltShiftBlurPx,
    sparkleOpacity,
    glitchSliceOpacity,
    isDynamicEffect
  }
}

/**
 * 编译成片导出用的 FFmpeg 视频滤镜链（不含参数内逗号，确保可安全嵌入任何 filter_complex 链）
 */
export function buildClipVisualFfmpegFilter(
  clip?: Partial<TimelineClipCreativeProps> | null
): string | null {
  if (!clip) return null
  const filterMeta = getTimelineFilterPresetMeta(clip.filterPreset)
  const filterScale =
    filterMeta.id === 'none' ? 0 : clampRange(clip.filterIntensity, 0, 100, 100) / 100
  const effectMeta = getTimelineVisualEffectMeta(clip.visualEffect)
  const effectScale =
    effectMeta.id === 'none' ? 0 : clampRange(clip.effectIntensity, 0, 100, 75) / 100

  const userBrightness = clampRange(clip.brightness, -0.5, 0.5, 0)
  const userContrast = clampRange(clip.contrast, 0.5, 2, 1)
  const userSaturation = clampRange(clip.saturation, 0, 3, 1)
  const userVibrance = clampRange(clip.vibrance, -100, 100, 0)
  const userTemp = clampRange(clip.temperature, -100, 100, 0)
  const userTint = clampRange(clip.tint, -100, 100, 0)
  const userHighlights = clampRange(clip.highlights, -100, 100, 0)
  const userShadows = clampRange(clip.shadows, -100, 100, 0)
  const userSharpen = clampRange(clip.sharpen, 0, 100, 0)
  const userVignette = clampRange(clip.vignette, 0, 100, 0)
  const userFade = clampRange(clip.fade, 0, 100, 0)
  const userGrain = clampRange(clip.grain, 0, 100, 0)

  const totalFade = userFade + filterMeta.recipe.fade * filterScale

  let eqBrightness =
    userBrightness +
    filterMeta.recipe.brightness * filterScale +
    totalFade * 0.0008 +
    (userHighlights * 0.001 + userShadows * 0.0012)

  let eqContrast =
    userContrast *
    (1 + (filterMeta.recipe.contrast - 1) * filterScale) *
    (1 + (userHighlights - userShadows) * 0.0012) *
    (1 - totalFade * 0.0016)

  let eqSaturation =
    userSaturation *
    (1 + (userVibrance / 100) * 0.42) *
    (1 + (filterMeta.recipe.saturation - 1) * filterScale) *
    (1 - totalFade * 0.0015)

  let eqGamma = 1
  if (Math.abs(userShadows) >= 1 || Math.abs(userHighlights) >= 1) {
    eqGamma = clampRange(1 + (userShadows * 0.0035 + userHighlights * 0.002), 0.6, 1.6, 1)
  }

  // 特效对 eq 的加成
  if (effectMeta.id === 'bw-spotlight') {
    eqSaturation *= Math.max(0, 1 - 0.95 * effectScale)
    eqContrast *= 1 + 0.25 * effectScale
  } else if (effectMeta.id === 'old-film') {
    eqSaturation *= Math.max(0.25, 1 - 0.35 * effectScale)
    eqContrast *= 1 + 0.14 * effectScale
  } else if (effectMeta.id === 'dreamy-bloom' || effectMeta.id === 'gold-sparkle') {
    eqBrightness += 0.04 * effectScale
    eqContrast *= 1 - 0.04 * effectScale
  } else if (
    effectMeta.id === 'beat-pulse' ||
    effectMeta.id === 'strobe-flash' ||
    effectMeta.id === 'soul-out' ||
    effectMeta.id === 'zoom-burst'
  ) {
    eqBrightness += 0.05 * effectScale
    eqContrast *= 1 + 0.12 * effectScale
  } else if (effectMeta.id === 'posterize-pop') {
    eqContrast *= 1 + 0.45 * effectScale
    eqSaturation *= 1 + 0.55 * effectScale
  } else if (effectMeta.id === 'neon-edge' || effectMeta.id === 'neon-halo') {
    eqSaturation *= 1 + 0.35 * effectScale
    eqContrast *= 1 + 0.16 * effectScale
  }

  eqBrightness = clampRange(eqBrightness, -0.5, 0.5, 0)
  eqContrast = clampRange(eqContrast, 0.4, 2.4, 1)
  eqSaturation = clampRange(eqSaturation, 0, 3, 1)

  const chain: string[] = []

  if (
    Math.abs(eqBrightness) > 0.005 ||
    Math.abs(eqContrast - 1) > 0.01 ||
    Math.abs(eqSaturation - 1) > 0.01 ||
    Math.abs(eqGamma - 1) > 0.01
  ) {
    chain.push(
      `eq=brightness=${eqBrightness.toFixed(3)}:contrast=${eqContrast.toFixed(3)}:saturation=${eqSaturation.toFixed(3)}:gamma=${eqGamma.toFixed(3)}`
    )
  }

  // 色温 / 色调 / 滤镜色彩平衡 (colorbalance)
  const totalTemp =
    userTemp +
    filterMeta.recipe.temperature * filterScale +
    (effectMeta.id === 'sunset-leak' ? 28 * effectScale : 0)
  const totalTint =
    userTint +
    filterMeta.recipe.tint * filterScale +
    (effectMeta.id === 'cyber-matrix' || effectMeta.id === 'night-vision' ? -36 * effectScale : 0)
  const fb = filterMeta.recipe.colorBalance

  const rs = clampRange(
    (fb?.rs ?? 0) * filterScale + (totalTemp / 100) * 0.14 + (userShadows / 100) * 0.06,
    -0.5,
    0.5,
    0
  )
  const gs = clampRange(
    (fb?.gs ?? 0) * filterScale - (totalTint / 100) * 0.12 + (userShadows / 100) * 0.06,
    -0.5,
    0.5,
    0
  )
  const bs = clampRange(
    (fb?.bs ?? 0) * filterScale - (totalTemp / 100) * 0.16 + (userShadows / 100) * 0.06,
    -0.5,
    0.5,
    0
  )

  const rm = clampRange(
    (fb?.rm ?? 0) * filterScale + (totalTemp / 100) * 0.18 + (totalTint / 100) * 0.08,
    -0.5,
    0.5,
    0
  )
  const gm = clampRange((fb?.gm ?? 0) * filterScale - (totalTint / 100) * 0.14, -0.5, 0.5, 0)
  const bm = clampRange(
    (fb?.bm ?? 0) * filterScale - (totalTemp / 100) * 0.18 + (totalTint / 100) * 0.06,
    -0.5,
    0.5,
    0
  )

  const rh = clampRange(
    (fb?.rh ?? 0) * filterScale + (totalTemp / 100) * 0.16 + (userHighlights / 100) * 0.1,
    -0.5,
    0.5,
    0
  )
  const gh = clampRange(
    (fb?.gh ?? 0) * filterScale - (totalTint / 100) * 0.1 + (userHighlights / 100) * 0.1,
    -0.5,
    0.5,
    0
  )
  const bh = clampRange(
    (fb?.bh ?? 0) * filterScale - (totalTemp / 100) * 0.16 + (userHighlights / 100) * 0.1,
    -0.5,
    0.5,
    0
  )

  if (
    Math.abs(rs) > 0.01 ||
    Math.abs(gs) > 0.01 ||
    Math.abs(bs) > 0.01 ||
    Math.abs(rm) > 0.01 ||
    Math.abs(gm) > 0.01 ||
    Math.abs(bm) > 0.01 ||
    Math.abs(rh) > 0.01 ||
    Math.abs(gh) > 0.01 ||
    Math.abs(bh) > 0.01
  ) {
    chain.push(
      `colorbalance=rs=${rs.toFixed(3)}:gs=${gs.toFixed(3)}:bs=${bs.toFixed(3)}:rm=${rm.toFixed(3)}:gm=${gm.toFixed(3)}:bm=${bm.toFixed(3)}:rh=${rh.toFixed(3)}:gh=${gh.toFixed(3)}:bh=${bh.toFixed(3)}`
    )
  }

  // 色相偏移
  const hueDeg =
    filterMeta.recipe.hueRotateDeg * filterScale +
    (effectMeta.id === 'thermal-vision' ? 160 * effectScale : 0) +
    (effectMeta.id === 'neon-edge' ? 24 * effectScale : 0)
  if (Math.abs(hueDeg) > 0.5) {
    chain.push(`hue=h=${hueDeg.toFixed(1)}`)
  }

  // 复古泛黄 (old-film / vintage-sepia)
  const sepiaStrength = Math.max(
    filterMeta.id === 'vintage-sepia' ? 0.55 * filterScale : 0,
    effectMeta.id === 'old-film' ? 0.6 * effectScale : 0
  )
  if (sepiaStrength > 0.15) {
    const s = clampRange(sepiaStrength, 0, 1, 0.5)
    const rr = (1 - s + 0.393 * s).toFixed(3)
    const rg = (0.769 * s).toFixed(3)
    const rb = (0.189 * s).toFixed(3)
    const gr = (0.349 * s).toFixed(3)
    const gg = (1 - s + 0.686 * s).toFixed(3)
    const gb = (0.168 * s).toFixed(3)
    const br = (0.272 * s).toFixed(3)
    const bg = (0.534 * s).toFixed(3)
    const bb = (1 - s + 0.131 * s).toFixed(3)
    chain.push(
      `colorchannelmixer=rr=${rr}:rg=${rg}:rb=${rb}:gr=${gr}:gg=${gg}:gb=${gb}:br=${br}:bg=${bg}:bb=${bb}`
    )
  }

  // 锐化 (unsharp)
  const effectiveSharpen = Math.max(
    userSharpen,
    effectMeta.id === 'camera-shake' || effectMeta.id === 'earthquake' ? 18 * effectScale : 0,
    effectMeta.id === 'dv-cam' || effectMeta.id === 'pendulum-swing' ? 15 * effectScale : 0
  )
  if (effectiveSharpen >= 2) {
    const lumaAmount = clampRange((effectiveSharpen / 100) * 1.6, 0.05, 2.0, 0.5)
    chain.push(`unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=${lumaAmount.toFixed(2)}`)
  }

  // 柔焦/移轴/马赛克 (boxblur)
  if (
    effectMeta.id === 'blur-focus' ||
    effectMeta.id === 'tilt-shift' ||
    effectMeta.id === 'pixel-mosaic'
  ) {
    const rad = Math.max(1, Math.round(2 * effectScale))
    chain.push(`boxblur=luma_radius=${rad}:luma_power=1`)
  }

  // 画面特效专属滤镜
  if (
    effectMeta.id === 'rgb-glitch' ||
    effectMeta.id === 'vhs-retro' ||
    effectMeta.id === 'bad-tv' ||
    effectMeta.id === 'soul-out'
  ) {
    const shift = Math.max(2, Math.round((effectMeta.id === 'rgb-glitch' ? 8 : 5) * effectScale))
    chain.push(`rgbashift=rh=${shift}:bh=${-shift}:rv=1:bv=-1`)
  }
  if (
    (effectMeta.id === 'negative-invert' || effectMeta.id === 'thermal-vision') &&
    effectScale > 0.1
  ) {
    chain.push('negate')
  }
  if (effectMeta.id === 'cinema-letterbox' && effectScale > 0.1) {
    const barRatio = Number((0.12 * Math.max(0.5, effectScale)).toFixed(3))
    const bottomY = Number((1 - barRatio).toFixed(3))
    chain.push(
      `drawbox=x=0:y=0:w=iw:h=ih*${barRatio}:color=black:t=fill`,
      `drawbox=x=0:y=ih*${bottomY}:w=iw:h=ih*${barRatio}:color=black:t=fill`
    )
  }
  if (effectMeta.id === 'split-2h') {
    chain.push('drawbox=x=iw*0.498:y=0:w=iw*0.004:h=ih:color=white:t=fill')
  } else if (effectMeta.id === 'split-3v') {
    chain.push(
      'drawbox=x=iw*0.331:y=0:w=iw*0.004:h=ih:color=white:t=fill',
      'drawbox=x=iw*0.665:y=0:w=iw*0.004:h=ih:color=white:t=fill'
    )
  } else if (effectMeta.id === 'split-4grid') {
    chain.push(
      'drawbox=x=iw*0.498:y=0:w=iw*0.004:h=ih:color=white:t=fill',
      'drawbox=x=0:y=ih*0.498:w=iw:h=ih*0.004:color=white:t=fill'
    )
  }

  // 颗粒噪点 (noise)
  const effectiveGrain = Math.max(
    userGrain,
    effectMeta.id === 'old-film' || effectMeta.id === 'night-vision' ? 35 * effectScale : 0,
    effectMeta.id === 'vhs-retro' || effectMeta.id === 'bad-tv' ? 28 * effectScale : 0
  )
  if (effectiveGrain >= 2) {
    const strength = Math.min(36, Math.max(2, Math.round(effectiveGrain * 0.32)))
    chain.push(`noise=alls=${strength}:allf=t+u`)
  }

  // 暗角 (vignette)
  const effectiveVignette = Math.max(
    userVignette,
    filterMeta.recipe.vignette * filterScale,
    effectMeta.id === 'bw-spotlight' ? 75 * effectScale : 0,
    effectMeta.id === 'old-film' || effectMeta.id === 'night-vision' ? 45 * effectScale : 0,
    effectMeta.id === 'dv-cam' || effectMeta.id === 'neon-halo' ? 25 * effectScale : 0
  )
  if (effectiveVignette >= 3) {
    const angleRad = clampRange(0.16 + (effectiveVignette / 100) * 0.62, 0.15, 0.78, 0.4)
    chain.push(`vignette=angle=${angleRad.toFixed(3)}`)
  }

  return chain.length > 0 ? chain.join(',') : null
}

/**
 * 一键套用剪映式成片模板：
 * - 若时间线当前无主视频轨片段且有可用视频素材，自动将视频素材顺次铺入主视频轨；
 * - 批量写入滤镜预设、画面特效、色彩微调、运镜预设、入出场动效；
 * - 为相邻主视频轨片段批量设置切点转场（支持交替转场序列）；
 * - 同步更新字幕样式到 settings。
 */
export function applyTimelineCreativeTemplateToClips(
  clips: ScriptTimelineClip[],
  sources: ScriptTimelineSource[],
  settings: ScriptTimelineSettings,
  templateId: TimelineCreativeTemplateId,
  applyTransitionPairFn: (
    list: ScriptTimelineClip[],
    leftId: string,
    rightId: string,
    opts: { transitionType: ScriptTimelineTransitionType; durationSec: number }
  ) => ScriptTimelineClip[]
): {
  clips: ScriptTimelineClip[]
  settings: ScriptTimelineSettings
  appliedVideoClipCount: number
} {
  const tpl =
    TIMELINE_CREATIVE_TEMPLATES.find((item) => item.id === templateId) ??
    TIMELINE_CREATIVE_TEMPLATES[0]
  let workingClips = clips.map((c) => ({ ...c }))

  const existingVideoClips = workingClips.filter((c) => c.track === 'video')
  if (existingVideoClips.length === 0) {
    const primaryVideoSources = sources.filter(
      (s) => (s.mediaKind ?? 'video') === 'video' && (s.relativePath || s.assetId)
    )
    const visualSources =
      primaryVideoSources.length > 0
        ? primaryVideoSources
        : sources.filter(
            (s) => (s.mediaKind ?? 'video') !== 'voice' && Boolean(s.relativePath || s.assetId)
          )
    let cursorSec = 0
    for (let i = 0; i < visualSources.length; i += 1) {
      const src = visualSources[i]
      const dur = clampRange(src.durationSec, 1.5, 12, 3.5)
      workingClips.push({
        id: `clip-tpl-${Date.now().toString(36)}-${i}`,
        track: 'video',
        sourceId: src.id,
        title: src.title,
        relativePath: src.relativePath,
        assetId: src.assetId,
        nodeId: src.nodeId,
        nodeTitle: src.nodeTitle,
        startSec: Number(cursorSec.toFixed(3)),
        durationSec: Number(dur.toFixed(3))
      })
      cursorSec += dur
    }
  }

  const sortedVideoIds = workingClips
    .filter((c) => c.track === 'video')
    .slice()
    .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id))
    .map((c) => c.id)

  const videoIndexById = new Map<string, number>()
  sortedVideoIds.forEach((id, idx) => videoIndexById.set(id, idx))

  const { recipe } = tpl
  workingClips = workingClips.map((clip) => {
    if (clip.track !== 'video' && clip.track !== 'overlay') return clip
    const idx = videoIndexById.get(clip.id) ?? 0
    const cameraMotion =
      clip.track === 'video' && recipe.cameraMotions.length > 0
        ? recipe.cameraMotions[idx % recipe.cameraMotions.length]
        : clip.cameraMotion
    return {
      ...clip,
      filterPreset: recipe.filterPreset,
      filterIntensity: recipe.filterIntensity,
      visualEffect: recipe.visualEffect,
      effectIntensity: recipe.effectIntensity,
      brightness: recipe.adjustments.brightness ?? 0,
      contrast: recipe.adjustments.contrast ?? 1,
      saturation: recipe.adjustments.saturation ?? 1,
      vibrance: recipe.adjustments.vibrance ?? 0,
      temperature: recipe.adjustments.temperature ?? 0,
      tint: recipe.adjustments.tint ?? 0,
      highlights: recipe.adjustments.highlights ?? 0,
      shadows: recipe.adjustments.shadows ?? 0,
      sharpen: recipe.adjustments.sharpen ?? 0,
      vignette: recipe.adjustments.vignette ?? 0,
      fade: recipe.adjustments.fade ?? 0,
      grain: recipe.adjustments.grain ?? 0,
      ...(clip.track === 'video' && cameraMotion ? { cameraMotion } : {}),
      ...(clip.track === 'overlay'
        ? {
            tweenIn: recipe.tweenIn,
            tweenOut: recipe.tweenOut
          }
        : {})
    }
  })

  if (sortedVideoIds.length >= 2) {
    const altList =
      recipe.alternatingTransitions && recipe.alternatingTransitions.length > 0
        ? recipe.alternatingTransitions
        : [recipe.transitionType]
    for (let i = 0; i < sortedVideoIds.length - 1; i += 1) {
      const tType = altList[i % altList.length]
      workingClips = applyTransitionPairFn(workingClips, sortedVideoIds[i], sortedVideoIds[i + 1], {
        transitionType: tType,
        durationSec: recipe.transitionDurationSec
      })
    }
  }

  const nextSettings: ScriptTimelineSettings = {
    ...settings,
    ...recipe.subtitleStyle
  }

  return {
    clips: workingClips,
    settings: nextSettings,
    appliedVideoClipCount: sortedVideoIds.length
  }
}
