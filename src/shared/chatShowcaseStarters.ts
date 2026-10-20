import { createNodeFromType } from './graph/create'
import { autoGroupLayersForGameUi, type ImageLayerSplitState } from './graph/imageLayerSplit'
import type { GraphDocument } from './graph/types'

export interface ChatShowcaseStarter {
  id: string
  icon: string
  badgeZh: string
  badgeEn: string
  titleZh: string
  titleEn: string
  descZh: string
  descEn: string
  pipelineTag: string
  accent: string
  promptZh: string
  promptEn: string
}

export const CHAT_SHOWCASE_STARTERS: readonly ChatShowcaseStarter[] = [
  {
    id: 'xianxia-ui-psd',
    icon: '🎮',
    badgeZh: '爆款推荐 · 直出 PSD',
    badgeEn: 'HOT · Layered PSD',
    titleZh: '仙侠游戏装备 UI + 拆分 PSD',
    titleEn: 'Xianxia RPG Equipment UI + Layered PSD',
    descZh: '生成国风暗金仙侠装备界面，并自动剥离控件图层、归类文件夹导出可编辑 .psd',
    descEn:
      'Generate an oriental fantasy equipment UI, isolate transparent widgets, and export a grouped .psd',
    pipelineTag: 'asset.image ➔ image.layerSplit',
    accent: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
    promptZh:
      '在当前画布创建一个国风仙侠手游的「法宝装备界面」UI（16:9 横版，包含顶部灵石货币栏、左侧剑仙立绘与六个装备槽位、右侧法宝属性面板与底部的金色“祭炼升阶”主按钮），并连入图层分离节点拆分出分层 PSD 文件',
    promptEn:
      'On the active canvas, create a 16:9 Xianxia RPG Equipment UI screen (top currency bar, left character & 6 gear slots, right artifact stats panel, and golden Upgrade button) wired into image.layerSplit to export a layered PSD'
  },
  {
    id: 'cyber-short-drama',
    icon: '🎬',
    badgeZh: '漫剧工作台',
    badgeEn: 'Storyboard Studio',
    titleZh: '赛博霓虹 4 镜头漫剧分镜表',
    titleEn: 'Cyberpunk 4-Shot Storyboard & Video',
    descZh: '锁定主角外观一致性，一键拆解景别、运镜、台词并批量生成分镜关键帧',
    descEn:
      'Lock character identity, break down 4 cinematic shots with camera moves, and generate keyframes',
    pipelineTag: 'film.workbench',
    accent: 'linear-gradient(135deg, #6366f1 0%, #ec4899 100%)',
    promptZh:
      '在当前画布创建影视分镜工作台（film.workbench），规划一段 4 镜头的赛博朋克雨夜追逐短剧（银发女黑客在霓虹天台逃脱无人机追捕），锁定角色设定并生成 4 个镜头的关键帧分镜图',
    promptEn:
      'Create a film.workbench node on the active canvas for a 4-shot cyberpunk rainy rooftop chase starring a silver-haired hacker, lock cast consistency, and generate the 4 shot keyframes'
  },
  {
    id: 'portrait-id-photo',
    icon: '🪪',
    badgeZh: '人像精修台',
    badgeEn: 'Portrait & ID Studio',
    titleZh: '商业级人像精修 + 证件照排版',
    titleEn: 'Studio Portrait Retouch & ID Sheet',
    descZh: '保留真实毛孔质感磨皮、眼神光增强、五官立体微调，一键输出标准一寸排版版面',
    descEn:
      'Pore-preserving skin retouch, catchlight boost, facial sculpting, and 1-inch ID print sheet',
    pipelineTag: 'asset.image ➔ image.portrait',
    accent: 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)',
    promptZh:
      '在当前画布生成一张清透自然的职场女性半身棚拍肖像（asset.image），连入人像精修节点（image.portrait）开启标准磨皮、亮眼与立体光影，并生成一寸蓝底证件照冲印排版',
    promptEn:
      'Generate a clean studio business portrait (asset.image) on the active canvas, wire it into image.portrait with standard skin/eye retouching and 1-inch blue-background print sheet'
  },
  {
    id: 'char-stage2d-anim',
    icon: '🧸',
    badgeZh: '2D 骨骼舞台',
    badgeEn: '2D Rig & Stage',
    titleZh: 'Q版角色立绘 + 2D 骨骼呼吸动画',
    titleEn: 'Chibi Character + 2D Skeletal Animation',
    descZh: '生成透明背景 Q 版二次元骑士立绘，自动绑定 2D 关节骨架并导出待机序列帧与精灵表',
    descEn:
      'Generate a transparent chibi knight sprite, bind 2D skeletal joints, and export idle sprite sheets',
    pipelineTag: 'asset.image ➔ stage.2d',
    accent: 'linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%)',
    promptZh:
      '在当前画布创建一个开启透明背景的 Q 版女武神全身立绘生成节点（asset.image，generateTransparentBg=true），连入 2D 舞台节点（stage.2d）输出角色动作拼版',
    promptEn:
      'Create a transparent-background chibi valkyrie full-body sprite node (asset.image, generateTransparentBg=true) wired into a stage.2d node on the active canvas'
  },
  {
    id: 'studio-relight-3d',
    icon: '💡',
    badgeZh: '3D 交互布光',
    badgeEn: '3D Studio Relighting',
    titleZh: '高定香水瓶 3D 交互重打光',
    titleEn: 'Luxury Perfume 3D Interactive Relighting',
    descZh: '严格锁定商品主体与材质细节，使用双色霓虹轮廓光与黄金时刻预设重塑光影氛围',
    descEn:
      'Lock subject identity while relighting with dual neon rim lights and golden-hour studio presets',
    pipelineTag: 'asset.image ➔ image.lighting',
    accent: 'linear-gradient(135deg, #eab308 0%, #f97316 100%)',
    promptZh:
      '在当前画布生成一张黑曜石切面高定香水瓶商业摄影图（asset.image），连入智能打光节点（image.lighting）使用伦勃朗暖金轮廓光重打光并保持主体一致',
    promptEn:
      'Generate a luxury obsidian perfume bottle shot (asset.image) on the active canvas, wire it into image.lighting with warm golden Rembrandt rim lighting, and run it'
  },
  {
    id: 'rpg-icon-pack',
    icon: '🗡️',
    badgeZh: '图标包直出',
    badgeEn: '9-Grid Icon Pack',
    titleZh: '暗黑奇幻 9 宫格技能图标包',
    titleEn: 'Dark Fantasy 9-Grid Skill Icon Pack',
    descZh: '一次生成 3×3 统一画风技能与法宝图标，自动逐格键控抠除背景并居中对齐输出透明 PNG',
    descEn:
      'Generate a 3×3 cohesive icon grid and automatically key out backgrounds into aligned transparent PNGs',
    pipelineTag: 'asset.image ➔ image.iconPack',
    accent: 'linear-gradient(135deg, #ec4899 0%, #f43f5e 100%)',
    promptZh:
      '在当前画布创建 1:1 图片生成节点生成 3×3 九宫格暗黑奇幻魔法技能图标集（纯黑背景，互不重叠），并连入图标包导出节点（image.iconPack）自动切分抠出 9 枚独立透明 PNG 图标',
    promptEn:
      'Create a 1:1 asset.image node on the active canvas for a 3×3 grid of dark fantasy skill icons on solid black background, wired into image.iconPack to slice 9 transparent PNG icons'
  }
]

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`
}

/**
 * 构建「免 Key 秒开样板间」画布：
 * 预置一套已经跑完拆层、包含 6 张高清矢量透明图层与 3 个自动分组文件夹的「仙侠装备界面 UI + PSD 拆分」画布。
 * 新用户无需配置任何 API Key，点开后即可：
 * 1) 双击 `② UI 图层分离 → PSD` 节点进入工作台，体验「🧊 3D 全息层叠爆炸视图」；
 * 2) 一键导出真实分层 `.psd`、可点击交互 HTML5 游戏原型、Godot `.tscn` 与 Unity 预制体清单；
 * 3) 切换顶部「✨ 焦点模式」或一键导出隐写「📸 配方海报 PNG」。
 */
export function buildZeroKeyLiveDemoGraph(locale = 'zh-CN'): GraphDocument {
  const isEn = /^en/i.test(locale)
  const W = 1280
  const H = 720

  // z0: 纯净仙侠暗金玄晶底图（不含前景按钮与浮窗）
  const baseSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <defs>
      <radialGradient id="bg" cx="50%" cy="42%" r="70%">
        <stop offset="0%" stop-color="#1e293b"/>
        <stop offset="55%" stop-color="#0f172a"/>
        <stop offset="100%" stop-color="#070b14"/>
      </radialGradient>
      <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#fde68a"/>
        <stop offset="50%" stop-color="#d97706"/>
        <stop offset="100%" stop-color="#78350f"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <circle cx="430" cy="370" r="230" fill="none" stroke="url(#gold)" stroke-width="1.5" stroke-opacity="0.28" stroke-dasharray="8 6"/>
    <circle cx="430" cy="370" r="185" fill="none" stroke="#38bdf8" stroke-width="1" stroke-opacity="0.22"/>
    <rect x="24" y="20" width="${W - 48}" height="${H - 40}" rx="18" fill="none" stroke="url(#gold)" stroke-width="2" stroke-opacity="0.45"/>
  </svg>`

  // z1: 顶栏灵石与修为状态条
  const topBarSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1160 64" width="1160" height="64">
    <rect x="2" y="2" width="1156" height="60" rx="14" fill="#0f172acc" stroke="#f59e0b" stroke-width="2"/>
    <text x="32" y="40" fill="#fde68a" font-size="24" font-family="sans-serif" font-weight="bold">⚔️ 太虚剑宗 · 法宝洞天</text>
    <rect x="460" y="14" width="210" height="36" rx="18" fill="#1e293b" stroke="#38bdf8" stroke-width="1.5"/>
    <text x="485" y="38" fill="#7dd3fc" font-size="18" font-family="sans-serif">💎 极品灵石 128,500</text>
    <rect x="700" y="14" width="210" height="36" rx="18" fill="#1e293b" stroke="#f59e0b" stroke-width="1.5"/>
    <text x="725" y="38" fill="#fcd34d" font-size="18" font-family="sans-serif">🔥 战力 9,842,000</text>
  </svg>`

  // z2: 左侧剑仙角色立绘与八卦阵台容器
  const charCardSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 540" width="560" height="540">
    <rect x="4" y="4" width="552" height="532" rx="20" fill="#0f172ab8" stroke="#eab308" stroke-width="2"/>
    <circle cx="280" cy="245" r="145" fill="#1e293b99" stroke="#38bdf8" stroke-width="2"/>
    <path d="M280 95 L312 225 L280 375 L248 225 Z" fill="#38bdf8" fill-opacity="0.35" stroke="#bae6fd" stroke-width="2"/>
    <circle cx="280" cy="165" r="28" fill="#fde68a"/>
    <rect x="150" y="445" width="260" height="46" rx="12" fill="#1e293b" stroke="#f59e0b" stroke-width="1.5"/>
    <text x="280" y="475" text-anchor="middle" fill="#fef08a" font-size="20" font-family="sans-serif" font-weight="bold">化神巅峰 · 凌霄剑尊</text>
  </svg>`

  // z3: 右侧法宝词条详情面板（支持九宫格拉伸）
  const statsPanelSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 420" width="540" height="420">
    <rect x="3" y="3" width="534" height="414" rx="18" fill="#0f172ad9" stroke="#f59e0b" stroke-width="2.5"/>
    <rect x="28" y="26" width="484" height="54" rx="10" fill="#78350f66" stroke="#fbbf24" stroke-width="1.2"/>
    <text x="52" y="61" fill="#fde68a" font-size="24" font-family="sans-serif" font-weight="bold">【本命仙剑】太虚龙渊剑 · +15</text>
    <text x="40" y="128" fill="#94a3b8" font-size="18" font-family="sans-serif">基础飞剑攻击：+148,000（仙品共鸣 +35%）</text>
    <text x="40" y="172" fill="#38bdf8" font-size="18" font-family="sans-serif">✦ 词条一：御剑斩击附带九天玄雷真伤 +42%</text>
    <text x="40" y="214" fill="#a78bfa" font-size="18" font-family="sans-serif">✦ 词条二：暴击时召唤三柄太虚剑影协同齐射</text>
    <text x="40" y="256" fill="#34d399" font-size="18" font-family="sans-serif">✦ 词条三：破甲穿透 +28% · 冷却缩减 +15%</text>
    <rect x="40" y="305" width="460" height="74" rx="12" fill="#1e293b" stroke="#475569" stroke-width="1.2"/>
    <text x="64" y="348" fill="#e2e8f0" font-size="17" font-family="sans-serif">升阶材料：太虚玄铁 ×12 / 九转雷晶 ×4（已集齐）</text>
  </svg>`

  // z4: 右下角「一键祭炼升阶」主交互按钮（拆解为：无字常态背景 + 按下效果 + 独立按钮文字）
  const upgradeBtnBgNormalSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 84" width="320" height="84">
    <defs>
      <linearGradient id="btnG" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#fbbf24"/>
        <stop offset="50%" stop-color="#f59e0b"/>
        <stop offset="100%" stop-color="#b45309"/>
      </linearGradient>
    </defs>
    <rect x="4" y="4" width="312" height="76" rx="18" fill="url(#btnG)" stroke="#fef08a" stroke-width="2.5"/>
  </svg>`
  const upgradeBtnBgPressedSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 84" width="320" height="84">
    <defs>
      <linearGradient id="btnP" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#78350f"/>
        <stop offset="35%" stop-color="#b45309"/>
        <stop offset="100%" stop-color="#d97706"/>
      </linearGradient>
    </defs>
    <rect x="4" y="5" width="312" height="75" rx="18" fill="url(#btnP)" stroke="#f59e0b" stroke-width="2"/>
  </svg>`
  const upgradeBtnLabelSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 44" width="280" height="44">
    <text x="140" y="31" text-anchor="middle" fill="#0f172a" font-size="24" font-family="sans-serif" font-weight="bold">🔥 祭炼升阶 (突破仙品)</text>
  </svg>`
  const upgradeBtnSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 84" width="320" height="84">
    <image href="${svgToDataUrl(upgradeBtnBgNormalSvg)}" x="0" y="0" width="320" height="84"/>
    <image href="${svgToDataUrl(upgradeBtnLabelSvg)}" x="20" y="20" width="280" height="44"/>
  </svg>`

  // z5: 右下角「天工镶嵌」次级按钮
  const socketBtnSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 196 84" width="196" height="84">
    <rect x="4" y="4" width="188" height="76" rx="18" fill="#1e293b" stroke="#38bdf8" stroke-width="2"/>
    <text x="98" y="51" text-anchor="middle" fill="#7dd3fc" font-size="22" font-family="sans-serif" font-weight="bold">💠 剑魂镶嵌</text>
  </svg>`

  // 完整合成预览图 SVG
  const compositeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <image href="${svgToDataUrl(baseSvg)}" x="0" y="0" width="${W}" height="${H}"/>
    <image href="${svgToDataUrl(topBarSvg)}" x="60" y="32" width="1160" height="64"/>
    <image href="${svgToDataUrl(charCardSvg)}" x="60" y="124" width="560" height="540"/>
    <image href="${svgToDataUrl(statsPanelSvg)}" x="660" y="124" width="540" height="420"/>
    <image href="${svgToDataUrl(socketBtnSvg)}" x="660" y="572" width="196" height="84"/>
    <image href="${svgToDataUrl(upgradeBtnSvg)}" x="880" y="572" width="320" height="84"/>
  </svg>`

  const compositeUrl = svgToDataUrl(compositeSvg)
  const nowIso = new Date().toISOString()
  const layerItems = [
    {
      id: 'demo-layer-z0',
      title: isEn ? 'Base · Obsidian Immortal Hall' : '底图 · 仙府玄晶背板',
      dataUrl: svgToDataUrl(baseSvg),
      createdAt: nowIso
    },
    {
      id: 'demo-layer-z1',
      title: isEn ? 'TopBar · Spirit Stone HUD' : '顶栏 · 灵石修为状态条',
      dataUrl: svgToDataUrl(topBarSvg),
      createdAt: nowIso
    },
    {
      id: 'demo-layer-z2',
      title: isEn ? 'Panel · Sword Immortal Showcase' : '立绘面板 · 剑仙角色展示窗',
      dataUrl: svgToDataUrl(charCardSvg),
      createdAt: nowIso
    },
    {
      id: 'demo-layer-z3',
      title: isEn ? 'Panel · Artifact Stats Container' : '详情面板 · 太虚龙渊剑属性框',
      dataUrl: svgToDataUrl(statsPanelSvg),
      createdAt: nowIso
    },
    {
      id: 'demo-layer-z4',
      title: isEn ? 'Button · Spirit Gem Socket' : '交互按钮 · 剑魂镶嵌',
      dataUrl: svgToDataUrl(socketBtnSvg),
      createdAt: nowIso
    },
    {
      id: 'demo-layer-z5-pressed',
      title: isEn ? 'Ascend Button · Pressed BG' : '祭炼升阶 · 按下效果 (Pressed)',
      dataUrl: svgToDataUrl(upgradeBtnBgPressedSvg),
      createdAt: nowIso
    },
    {
      id: 'demo-layer-z5-bg',
      title: isEn ? 'Ascend Button · Normal BG' : '祭炼升阶 · 按钮背景 (Normal BG)',
      dataUrl: svgToDataUrl(upgradeBtnBgNormalSvg),
      createdAt: nowIso
    },
    {
      id: 'demo-layer-z5-label',
      title: isEn ? 'Ascend Button · Button Label' : '祭炼升阶 · 按钮文字 (Label)',
      dataUrl: svgToDataUrl(upgradeBtnLabelSvg),
      createdAt: nowIso
    }
  ]

  const rawSplitState: ImageLayerSplitState = {
    prompt: '',
    resolution: '2K',
    splitMode: 'auto',
    canvasWidth: W,
    canvasHeight: H,
    selectedId: 'layer-5-bg',
    sourceFingerprint: 'demo-xianxia-ui-v1',
    groups: [],
    layers: [
      {
        id: 'base',
        name: isEn ? 'Base · Obsidian Immortal Hall' : '底图 · 仙府玄晶背板',
        description: 'Clean UI background plate',
        zIndex: 0,
        left: 0,
        top: 0,
        width: W,
        height: H,
        role: 'canvas-base',
        visible: true,
        imageId: 'demo-layer-z0'
      },
      {
        id: 'layer-1',
        name: isEn ? 'TopBar · Spirit Stone HUD' : '顶栏 · 灵石修为状态条',
        description: 'Top navigation and currency status bar',
        zIndex: 1,
        left: 60,
        top: 32,
        width: 1160,
        height: 64,
        visible: true,
        imageId: 'demo-layer-z1',
        uiControlType: 'hud-bar',
        uiPartRole: 'hud-bar-bg'
      },
      {
        id: 'layer-2',
        name: isEn ? 'Panel · Sword Immortal Showcase' : '立绘面板 · 剑仙角色展示窗',
        description: 'Left character showcase container panel',
        zIndex: 2,
        left: 60,
        top: 124,
        width: 560,
        height: 540,
        visible: true,
        imageId: 'demo-layer-z2',
        uiControlType: 'panel',
        uiPartRole: 'panel-frame-bg',
        nineSliceBorders: [24, 24, 24, 24]
      },
      {
        id: 'layer-3',
        name: isEn ? 'Panel · Artifact Stats Container' : '详情面板 · 太虚龙渊剑属性框',
        description: 'Right equipment attribute frame panel',
        zIndex: 3,
        left: 660,
        top: 124,
        width: 540,
        height: 420,
        visible: true,
        imageId: 'demo-layer-z3',
        uiControlType: 'panel',
        uiPartRole: 'panel-frame-bg',
        nineSliceBorders: [24, 24, 24, 24]
      },
      {
        id: 'layer-4',
        name: isEn ? 'Button · Spirit Gem Socket' : '交互按钮 · 剑魂镶嵌',
        description: 'Secondary interactive button',
        zIndex: 4,
        left: 660,
        top: 572,
        width: 196,
        height: 84,
        visible: true,
        imageId: 'demo-layer-z4',
        uiControlType: 'button',
        uiPartRole: 'button-bg-normal'
      },
      {
        id: 'layer-5-pressed',
        name: isEn ? 'Ascend Button · Pressed BG' : '祭炼升阶 · 按下效果 (Pressed)',
        description: 'Unity UI Toolkit :active / HTML5 button:active pressed background layer',
        zIndex: 5,
        left: 880,
        top: 572,
        width: 320,
        height: 84,
        visible: false,
        imageId: 'demo-layer-z5-pressed',
        uiControlId: 'ctrl-upgrade-btn',
        uiControlName: isEn ? 'Ascend & Upgrade' : '祭炼升阶',
        uiControlType: 'button',
        uiPartRole: 'button-bg-pressed',
        nineSliceBorders: [18, 18, 18, 18]
      },
      {
        id: 'layer-5-bg',
        name: isEn ? 'Ascend Button · Normal BG' : '祭炼升阶 · 按钮背景 (Normal BG)',
        description: 'Clean text-free 9-slice button normal background plate',
        zIndex: 6,
        left: 880,
        top: 572,
        width: 320,
        height: 84,
        visible: true,
        imageId: 'demo-layer-z5-bg',
        uiControlId: 'ctrl-upgrade-btn',
        uiControlName: isEn ? 'Ascend & Upgrade' : '祭炼升阶',
        uiControlType: 'button',
        uiPartRole: 'button-bg-normal',
        nineSliceBorders: [18, 18, 18, 18]
      },
      {
        id: 'layer-5-label',
        name: isEn ? 'Ascend Button · Button Label' : '祭炼升阶 · 按钮文字 (Label)',
        description: 'Isolated transparent button text label layer',
        zIndex: 7,
        left: 900,
        top: 592,
        width: 280,
        height: 44,
        visible: true,
        imageId: 'demo-layer-z5-label',
        uiControlId: 'ctrl-upgrade-btn',
        uiControlName: isEn ? 'Ascend & Upgrade' : '祭炼升阶',
        uiControlType: 'button',
        uiPartRole: 'button-label'
      }
    ]
  }

  const groupedState = autoGroupLayersForGameUi(rawSplitState, locale)

  const imgNode = createNodeFromType(
    'asset.image',
    { x: 140, y: 180 },
    {
      id: 'demo-ui-main',
      title: isEn ? '① Xianxia Equipment UI' : '① 仙侠法宝装备·主界面',
      params: {
        generateAspectRatio: '16:9',
        generateResolution: '2K',
        generateInstruction:
          '国风暗金仙侠手游「法宝装备界面」UI，16:9 横版，顶部灵石状态栏，左侧剑仙角色立绘展示框，右侧太虚龙渊剑属性词条面板，右下角金色祭炼升阶主按钮',
        previewDataUrl: compositeUrl,
        selectedImageId: 'demo-src-img',
        generatedImages: [
          {
            id: 'demo-src-img',
            title: isEn ? 'Xianxia Equipment UI' : '仙侠法宝装备界面',
            dataUrl: compositeUrl,
            createdAt: new Date().toISOString()
          }
        ]
      }
    }
  )

  const splitNode = createNodeFromType(
    'image.layerSplit',
    { x: 540, y: 180 },
    {
      id: 'demo-ui-layersplit',
      title: isEn ? '② UI Layer Split → PSD & 3D View' : '② UI 图层分离 → PSD / 3D 爆炸台',
      params: {
        imageLayerSplit: groupedState,
        previewDataUrl: compositeUrl,
        selectedImageId: 'demo-comp-img',
        generatedImages: [
          ...layerItems,
          {
            id: 'demo-comp-img',
            title: 'Composite',
            dataUrl: compositeUrl,
            createdAt: new Date().toISOString()
          }
        ]
      }
    }
  )

  return {
    nodes: [imgNode, splitNode],
    edges: [
      {
        id: 'demo-edge-1',
        source: imgNode.id,
        sourcePort: 'out',
        target: splitNode.id,
        targetPort: 'in'
      }
    ],
    viewport: { x: 60, y: 40, zoom: 1 }
  }
}
