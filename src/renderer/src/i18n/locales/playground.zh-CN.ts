/** 官网在线试玩（Machinations 机制沙盘 Playground）中文文案 */
export default {
  brand: {
    backHome: '← 返回官网',
    badge: 'ONLINE PLAYGROUND',
    subtitle: '游戏机制与经济数值沙盘 · 免安装在线试玩',
    autoSaved: '已自动暂存至浏览器',
    resetDemo: '重置当前模板'
  },
  presets: {
    label: '经典玩法速切：',
    deck: '🃏 杀戮尖塔 DBG',
    balatro: '🤡 小丑牌乘区',
    gacha: '💎 抽卡软硬保底',
    survivor: '⚔️ 幸存者波次',
    onmyoji: '🔥 阴阳师拉条鬼火',
    tower: '🏰 20波策略塔防',
    idle: '🏭 放置指数产线'
  },
  modes: {
    simple: '✦ 精简创作',
    pro: '⚙ 完整蓝图',
    playableBtn: '🎮 试玩卡牌 HUD',
    curveDragBtn: '📈 120fps 拖线反推',
    shareLink: '🔗 复制分享链接',
    linkCopied: '✓ 试玩链接已复制'
  },
  proTriggers: {
    aiWishBtn: '✨ AI 一句话建图',
    mcpBtn: '🔌 Claude / Cursor MCP',
    downstreamBtn: '🔗 下游全链路 ▾',
    saveProjectBtn: '💾 存入本地多工程',
    downloadCta: '⬇ 下载全量桌面版（免费开源）',
    dsNumerical: '⚔️ 联动「数值系统」微观 DPS / 养成配表',
    dsGdd: '📋 联动「策划案工作台」自动生成 100 分制 GDD',
    dsUiPsd: '🎨 联动「游戏 UI 拆层」直出 TySh 可编辑 PSD / Unity / Godot',
    dsPlayableHtml: '🕹️ 联动「一句话 HTML5 游戏」无头冒烟自检成片',
    dsSpine: '🦴 联动「2D 骨骼舞台」直出 Spine 2D 动画包',
    dsNovel: '📚 联动「小说与漫剧工作台」21 题材五阶段拍片'
  },
  banner: {
    tip: '💡 试玩提示：点击底部 ▶ 立即运行模拟；切到「可玩卡牌原型」亲手出牌，或在「运行结果」直接拖拽折线 120fps 反推最优公式！',
    tryAiLink: '想要一句话让 AI 自动搭好整套机制图？解锁免费全量桌面版 →',
    dismiss: '收起提示'
  },
  toast: {
    exportedTitle: '已导出 {file}！',
    exportedBody:
      '在免费全量桌面版中，可直接将该机制接入多模态节点画布，自动联动游戏 UI（PSD/Unity/Godot）、系统策划案与可玩 HTML5 原型。',
    exportedAction: '了解全量桌面版 →',
    importedOk: '已成功导入机制图：{title}',
    importedErr: '导入失败：请选择有效的 Machinations JSON 文件'
  },
  modal: {
    eyebrow: 'AI ART ENGINE · DESKTOP FULL EDITION (v8.9.5)',
    closeAria: '关闭弹窗',
    freeTag: 'GPL-3.0 永久免费开源 · 100% 本地工程 · 内置零 Key 体验',
    reasons: {
      ai_agent: {
        badge: '✨ AI Agent 自然语言建图与调参',
        title: '网页沙盘运行纯本地仿真引擎，AI 对话建图需安装全量桌面版',
        desc: '在全量桌面版中，只需在右侧 AI 对话框说一句话（如「做一套带软保底、星辉兑换与体力卡点的二次元抽卡经济」），内置 Agent 即可自动生成节点拓扑、跑通 100 步蒙特卡洛仿真并修复通胀死锁——内置零 Key 体验通道，亦可自由接入 30+ 云端模型或本地 Ollama。'
      },
      downstream: {
        badge: '🔗 跨工作台多模态工程管线联动',
        title: '在全量桌面版中，把当前经济模型一键连向整条游戏与短剧生产线',
        desc: '线上 Playground 仅提取了独立的「游戏机制与经济沙盘（game.economy）」单工作台。下载安装全量桌面版后，你的机制节点可通过强类型端口直接驱动下游 10+ 工业级子工作台：'
      },
      mcp: {
        badge: '🔌 102 工具双向本地 MCP 服务',
        title: '让 Claude Code、Cursor 与 Codex 直接接管你的数值沙盘与美术管线',
        desc: '全量桌面版内置 127.0.0.1 本地 MCP 服务（93 个全模态画布/数值/UI/影视工具 + 9 个 Blender 3D 建模工具）。一行 npx -y ai-art-engine-mcp 即可让外部编程 Agent 读取当前数值曲线、反推参数并同步生成 Unity / Godot 工程代码。'
      },
      workspace: {
        badge: '💾 本地多工程持久化与 PNG 即工作流',
        title: '安装全量桌面版，享受本地硬盘多工程管理与 6 路并发 Agent',
        desc: '网页端改动仅暂存在当前浏览器缓存中。你可以先在下方一键导出当前设计的 .mx.json 文件，安装全量桌面版后直接导入，享受 100% 本地工程主权、24h 定时自动化与 aiae:graph（PNG 拖入即还原整条管线）。'
      },
      export_nudge: {
        badge: '🚀 从单点机制走向完整可编辑游戏工程',
        title: '代码与架构已就绪！用全量桌面版补齐 UI、骨骼与可玩原型',
        desc: '你刚刚导出了机制工程产物。在免费开源的全量桌面版 AI Art Engine 中，不仅能继续深度调优数值，还能一站式产出配套的原生可编辑 PSD、Unity/Godot UI、Spine 2D 角色骨骼与无头冒烟自检的 single.html 可玩原型。'
      },
      cta: {
        badge: '🎁 免费解锁完整 10+ 专业子工作台与 AI Agent',
        title: '下载 AI Art Engine 全量桌面版，开启完整全模态游戏与影视工坊',
        desc: '当前网页端展示的仅仅是 AI Art Engine 10+ 专业 Dive 子工作台中的「冰山一角」。桌面全量版永久免费开源（GPL-3.0），无订阅墙、无云端锁死，内置零 Key 极速体验。'
      }
    },
    highlightsTitle: '全量桌面版额外解锁的核心能力：',
    highlights: {
      h1Title: '内置 AI 对话 & 6 路多工程并行',
      h1Desc: '一句话搭机制、拆 UI、写剧本，多工程后台并发互不阻塞',
      h2Title: '游戏 UI 拆层 → 原生 TySh PSD & Unity/Godot',
      h2Desc: '16 类控件识别 + 离线 OCR 提字抹底 + 图集零幻觉拼装',
      h3Title: 'Spine 2D 骨骼绑定 & 一句话可玩 HTML5',
      h3Desc: '单张立绘直出 Spine 骨骼包；无头浏览器冒烟自检生成可玩游戏',
      h4Title: '102 工具本地 MCP & 21 题材 AI 漫剧工作台',
      h4Desc: 'Claude Code / Cursor / Blender 直连；短剧锁脸拍片直出剪映草稿'
    },
    carryWorkTitle: '无缝带走你当前的沙盘进度：',
    carryWorkDesc:
      '先保存当前画布为 .mx.json，打开桌面版「经济系统」节点点击「导入 JSON」即可 100% 还原。',
    exportCurrentBtn: '📦 导出当前 .mx.json 备用',
    primaryWin: '⬇ 下载 Windows 桌面版 (.exe)',
    primaryMac: '⬇ 下载 macOS 桌面版 (.dmg)',
    primaryLinux: '⬇ 下载 Linux 桌面版 (.AppImage)',
    allPlatforms: '查看全部平台安装包 (GitHub Releases)',
    giteeMirror: '国内高速镜像 (Gitee Releases)',
    mcpSnippetLabel: '桌面版安装后，外部 Agent 零配置一键接入：',
    continueSandbox: '继续在网页沙盘试玩'
  }
} as const
