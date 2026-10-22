/**
 * 标准 UI 控件规范与结构化拆解引擎（Aligned with HTML5 Standard Controls, Unity UI Toolkit `UnityEngine.UIElements`, & Game UI Anatomy）
 *
 * 核心流程：
 *   Step 1: 识别画面中的 UI 控件类型（16 类 `UiControlType`：
 *           Button / Slider / ProgressBar / ListView / TabBar / Toggle / RadioButton / Dropdown /
 *           TextField / Scroller / Foldout / ItemSlot / RadialProgress / HUDStatusBar / Panel / IconBadge）
 *   Step 2: 按标准控件解剖学结构（Anatomy）将单个控件拆解为独立子部件图层（`UiControlPartRole`）：
 *           - Button         → 按钮文字 (`button-label`) + 按钮图标 (`button-icon`) + 按钮背景·常态 (`button-bg-normal`) + 悬停效果 (`button-bg-hover`) + 按下效果 (`button-bg-pressed`)
 *           - Slider         → 滑块文字 (`slider-label`) + 滑块手柄 (`slider-thumb` / `#unity-dragger`) + 进度填充条 (`slider-fill` / `#unity-fill`) + 轨道底槽 (`slider-track` / `#unity-tracker`)
 *           - ProgressBar    → 进度文字 (`slider-label`) + 进度填充 (`slider-fill`) + 轨道底槽 (`slider-track`)
 *           - ItemSlot       → 强化等级文字 (`slot-level-text`) + 右上角角标 (`slot-corner-badge`) + 装备主体图标 (`slot-item-icon`) + 品质发光外框 (`slot-rarity-frame`) + 凹槽底板 (`slot-bg`)
 *           - ListView       → 列表项文字 (`list-item-label`) + 列表项图标 (`list-item-icon`) + 列表项背景槽 (`list-item-bg`) + 列表滚动条 (`list-scrollbar`) + 列表视口底板 (`list-viewport-bg`)
 *           - TabBar         → 页签文字 (`tab-label`) + 激活态页签 (`tab-item-active`) + 未激活页签 (`tab-item-inactive`) + 页签栏底槽 (`tab-bar-bg`)
 *           - Dropdown       → 选中项文字 (`dropdown-value-text`) + 下拉三角箭头 (`dropdown-arrow`) + 下拉框底槽 (`dropdown-bg`)
 *           - RadioButton    → 选项文字 (`radio-label`) + 选中圆点 (`radio-checkmark`) + 单选外环底槽 (`radio-bg`)
 *           - Toggle         → 开关文字 (`toggle-label`) + 勾选图标 (`toggle-checkmark` / `#unity-checkmark`) + 勾选框底槽 (`toggle-bg`)
 *           - TextField      → 输入框文字 (`textfield-text` / `#unity-text-input`) + 前置图标 (`textfield-icon`) + 输入框底槽 (`textfield-bg`)
 *           - Scroller       → 滑块 (`scroller-thumb`) + 顶端微调按钮 (`scroller-low-btn`) + 底端微调按钮 (`scroller-high-btn`) + 滚动轨道 (`scroller-track`)
 *           - Foldout        → 折叠标题文字 (`foldout-title`) + 展开三角箭头 (`foldout-arrow`) + 标题栏底板 (`foldout-header-bg`) + 展开内容区 (`foldout-content`)
 *           - RadialProgress → 中心阵眼图标/文字 (`radial-center-icon`) + 发光环形进度 (`radial-fill-ring`) + 环形轨道底槽 (`radial-track-ring`)
 *           - HUDStatusBar   → 状态数值文字 (`hud-value-text`) + 状态图标 (`hud-icon`) + 状态栏底槽 (`hud-bar-bg`)
 *           - Panel          → 右上角关闭按钮 (`panel-close-btn`) + 面板标题文字 (`panel-title`) + 面板正文词条 (`panel-content-text`) + 面板九宫格纯净底板 (`panel-frame-bg`)
 *   Step 3: 映射为二级嵌套 PSD 文件夹树 + 原生 Photoshop 可编辑文本图层元数据（`UiEditableTextMeta`）
 */

export type UiControlType =
  | 'button'
  | 'slider'
  | 'progress-bar'
  | 'list-view'
  | 'tab-bar'
  | 'toggle'
  | 'radio-button'
  | 'dropdown'
  | 'text-field'
  | 'scroller'
  | 'foldout'
  | 'item-slot'
  | 'radial-progress'
  | 'hud-bar'
  | 'panel'
  | 'icon-badge'

export type UiControlPartRole =
  | 'canvas-base'
  // Button (<button> / ui:Button)
  | 'button-label'
  | 'button-icon'
  | 'button-bg-normal'
  | 'button-bg-hover'
  | 'button-bg-pressed'
  // Slider & ProgressBar (<input type="range"> / <progress> / ui:Slider / ui:ProgressBar)
  | 'slider-label'
  | 'slider-thumb'
  | 'slider-fill'
  | 'slider-track'
  // ItemSlot / EquipmentSlot (<button role="gridcell"> / .unity-item-slot)
  | 'slot-level-text'
  | 'slot-corner-badge'
  | 'slot-item-icon'
  | 'slot-rarity-frame'
  | 'slot-bg'
  // ListView & GridView (<ul role="listbox"> / ui:ListView / ui:ScrollView)
  | 'list-item-label'
  | 'list-item-icon'
  | 'list-item-bg'
  | 'list-scrollbar'
  | 'list-viewport-bg'
  // TabBar (<nav role="tablist"> / ui:TabView)
  | 'tab-label'
  | 'tab-item-active'
  | 'tab-item-inactive'
  | 'tab-bar-bg'
  // Dropdown (<select> / ui:DropdownField)
  | 'dropdown-value-text'
  | 'dropdown-arrow'
  | 'dropdown-bg'
  // RadioButton (<input type="radio"> / ui:RadioButton)
  | 'radio-label'
  | 'radio-checkmark'
  | 'radio-bg'
  // Toggle & Checkbox (<input type="checkbox"> / ui:Toggle)
  | 'toggle-label'
  | 'toggle-checkmark'
  | 'toggle-bg'
  // TextField (<input type="text"> / ui:TextField)
  | 'textfield-text'
  | 'textfield-icon'
  | 'textfield-bg'
  // Scroller (<div role="scrollbar"> / ui:Scroller)
  | 'scroller-thumb'
  | 'scroller-low-btn'
  | 'scroller-high-btn'
  | 'scroller-track'
  // Foldout (<details> / ui:Foldout)
  | 'foldout-title'
  | 'foldout-arrow'
  | 'foldout-header-bg'
  | 'foldout-content'
  // RadialProgress (<progress data-shape="radial"> / .unity-radial-progress)
  | 'radial-center-icon'
  | 'radial-fill-ring'
  | 'radial-track-ring'
  // HUDStatusBar (<header role="status"> / ui:VisualElement)
  | 'hud-value-text'
  | 'hud-icon'
  | 'hud-bar-bg'
  // Panel / Dialog / GroupBox (<section> / <dialog> / ui:GroupBox)
  | 'panel-close-btn'
  | 'panel-ornament'
  | 'panel-title'
  | 'panel-header'
  | 'panel-content-text'
  | 'panel-frame-bg'
  // Standalone Icon / Ornament
  | 'icon-graphic'

/**
 * 原生 Photoshop 可编辑文本图层（`TySh`）与引擎文本绑定元数据。
 * 在导出 PSD 时，除保留原艺术字像素外，自动将该图层声明为可在 Photoshop 中双击编辑文字的 Type Layer。
 */
export interface UiEditableTextMeta {
  /** 可编辑文本内容 */
  text: string
  /** 估算字号（px） */
  fontSize: number
  /** 采样自文字笔画像素的主色调 RGB (0-255) */
  color: [number, number, number]
  /** 采样自文字外圈轮廓的描边色 RGB (0-255，若存在明显描边则自动提取) */
  strokeColor?: [number, number, number]
  /** 估算文字描边宽度（px） */
  strokeWidth?: number
  /** 离线笔画连通投影检测出的字符/字形个数 */
  glyphCount?: number
  /** 文本对齐方式 */
  align?: 'left' | 'center' | 'right'
  /** PostScript 字体名（默认 MicrosoftYaHei-Bold） */
  fontName?: string
}

export interface UiControlSpecMeta {
  type: UiControlType
  html5Tag: string
  unityUiToolkitTag: string
  unityUssClass: string
  badgeZh: string
  badgeEn: string
  folderPrefixZh: string
  folderPrefixEn: string
  standardParts: readonly UiControlPartRole[]
}

export const UI_CONTROL_SPECS: Record<UiControlType, UiControlSpecMeta> = {
  button: {
    type: 'button',
    html5Tag: '<button type="button">',
    unityUiToolkitTag: '<ui:Button>',
    unityUssClass: '.unity-button',
    badgeZh: 'Button · 按钮控件',
    badgeEn: 'Button',
    folderPrefixZh: '[Button 按钮]',
    folderPrefixEn: '[Button]',
    standardParts: [
      'button-label',
      'button-icon',
      'button-bg-normal',
      'button-bg-hover',
      'button-bg-pressed'
    ]
  },
  slider: {
    type: 'slider',
    html5Tag: '<input type="range">',
    unityUiToolkitTag: '<ui:Slider>',
    unityUssClass: '.unity-slider',
    badgeZh: 'Slider · 滑动条控件',
    badgeEn: 'Slider',
    folderPrefixZh: '[Slider 滑动条]',
    folderPrefixEn: '[Slider]',
    standardParts: ['slider-label', 'slider-thumb', 'slider-fill', 'slider-track']
  },
  'progress-bar': {
    type: 'progress-bar',
    html5Tag: '<progress>',
    unityUiToolkitTag: '<ui:ProgressBar>',
    unityUssClass: '.unity-progress-bar',
    badgeZh: 'ProgressBar · 进度条',
    badgeEn: 'ProgressBar',
    folderPrefixZh: '[ProgressBar 进度条]',
    folderPrefixEn: '[ProgressBar]',
    standardParts: ['slider-label', 'slider-fill', 'slider-track']
  },
  'item-slot': {
    type: 'item-slot',
    html5Tag: '<button role="gridcell">',
    unityUiToolkitTag: '<ui:VisualElement class="unity-item-slot">',
    unityUssClass: '.unity-item-slot',
    badgeZh: 'ItemSlot · 装备/道具格子',
    badgeEn: 'ItemSlot',
    folderPrefixZh: '[ItemSlot 装备槽]',
    folderPrefixEn: '[ItemSlot]',
    standardParts: [
      'slot-level-text',
      'slot-corner-badge',
      'slot-item-icon',
      'slot-rarity-frame',
      'slot-bg'
    ]
  },
  'list-view': {
    type: 'list-view',
    html5Tag: '<ul role="listbox">',
    unityUiToolkitTag: '<ui:ListView>',
    unityUssClass: '.unity-list-view',
    badgeZh: 'ListView · 列表/网格容器',
    badgeEn: 'ListView',
    folderPrefixZh: '[ListView 列表]',
    folderPrefixEn: '[ListView]',
    standardParts: [
      'list-item-label',
      'list-item-icon',
      'list-item-bg',
      'list-scrollbar',
      'list-viewport-bg'
    ]
  },
  'tab-bar': {
    type: 'tab-bar',
    html5Tag: '<nav role="tablist">',
    unityUiToolkitTag: '<ui:TabView>',
    unityUssClass: '.unity-tab-view',
    badgeZh: 'TabView · 切页导航栏',
    badgeEn: 'TabView',
    folderPrefixZh: '[TabView 切页栏]',
    folderPrefixEn: '[TabView]',
    standardParts: ['tab-label', 'tab-item-active', 'tab-item-inactive', 'tab-bar-bg']
  },
  dropdown: {
    type: 'dropdown',
    html5Tag: '<select>',
    unityUiToolkitTag: '<ui:DropdownField>',
    unityUssClass: '.unity-base-popup-field',
    badgeZh: 'Dropdown · 下拉选择框',
    badgeEn: 'DropdownField',
    folderPrefixZh: '[Dropdown 下拉框]',
    folderPrefixEn: '[DropdownField]',
    standardParts: ['dropdown-value-text', 'dropdown-arrow', 'dropdown-bg']
  },
  'radio-button': {
    type: 'radio-button',
    html5Tag: '<input type="radio">',
    unityUiToolkitTag: '<ui:RadioButton>',
    unityUssClass: '.unity-radio-button',
    badgeZh: 'RadioButton · 单选框',
    badgeEn: 'RadioButton',
    folderPrefixZh: '[Radio 单选框]',
    folderPrefixEn: '[RadioButton]',
    standardParts: ['radio-label', 'radio-checkmark', 'radio-bg']
  },
  toggle: {
    type: 'toggle',
    html5Tag: '<input type="checkbox">',
    unityUiToolkitTag: '<ui:Toggle>',
    unityUssClass: '.unity-toggle',
    badgeZh: 'Toggle · 勾选开关',
    badgeEn: 'Toggle',
    folderPrefixZh: '[Toggle 开关]',
    folderPrefixEn: '[Toggle]',
    standardParts: ['toggle-label', 'toggle-checkmark', 'toggle-bg']
  },
  'text-field': {
    type: 'text-field',
    html5Tag: '<input type="text">',
    unityUiToolkitTag: '<ui:TextField>',
    unityUssClass: '.unity-text-field',
    badgeZh: 'TextField · 文本输入框',
    badgeEn: 'TextField',
    folderPrefixZh: '[TextField 输入框]',
    folderPrefixEn: '[TextField]',
    standardParts: ['textfield-text', 'textfield-icon', 'textfield-bg']
  },
  scroller: {
    type: 'scroller',
    html5Tag: '<div role="scrollbar">',
    unityUiToolkitTag: '<ui:Scroller>',
    unityUssClass: '.unity-scroller',
    badgeZh: 'Scroller · 独立滚动条',
    badgeEn: 'Scroller',
    folderPrefixZh: '[Scroller 滚动条]',
    folderPrefixEn: '[Scroller]',
    standardParts: ['scroller-thumb', 'scroller-low-btn', 'scroller-high-btn', 'scroller-track']
  },
  foldout: {
    type: 'foldout',
    html5Tag: '<details>',
    unityUiToolkitTag: '<ui:Foldout>',
    unityUssClass: '.unity-foldout',
    badgeZh: 'Foldout · 折叠抽屉栏',
    badgeEn: 'Foldout',
    folderPrefixZh: '[Foldout 折叠栏]',
    folderPrefixEn: '[Foldout]',
    standardParts: ['foldout-title', 'foldout-arrow', 'foldout-header-bg', 'foldout-content']
  },
  'radial-progress': {
    type: 'radial-progress',
    html5Tag: '<progress data-shape="radial">',
    unityUiToolkitTag: '<ui:VisualElement class="unity-radial-progress">',
    unityUssClass: '.unity-radial-progress',
    badgeZh: 'RadialProgress · 环形进度/冷却轮盘',
    badgeEn: 'RadialProgress',
    folderPrefixZh: '[Radial 环形进度]',
    folderPrefixEn: '[RadialProgress]',
    standardParts: ['radial-center-icon', 'radial-fill-ring', 'radial-track-ring']
  },
  'hud-bar': {
    type: 'hud-bar',
    html5Tag: '<header role="status">',
    unityUiToolkitTag: '<ui:VisualElement class="unity-hud-bar">',
    unityUssClass: '.unity-hud-bar',
    badgeZh: 'HUDStatusBar · 状态资源栏',
    badgeEn: 'HUDStatusBar',
    folderPrefixZh: '[HUD 状态栏]',
    folderPrefixEn: '[HUDStatusBar]',
    standardParts: ['hud-value-text', 'hud-icon', 'hud-bar-bg']
  },
  panel: {
    type: 'panel',
    html5Tag: '<section role="region">',
    unityUiToolkitTag: '<ui:GroupBox>',
    unityUssClass: '.unity-group-box',
    badgeZh: 'GroupBox · 面板容器',
    badgeEn: 'Panel / GroupBox',
    folderPrefixZh: '[Panel 面板]',
    folderPrefixEn: '[Panel]',
    standardParts: [
      'panel-close-btn',
      'panel-ornament',
      'panel-title',
      'panel-header',
      'panel-content-text',
      'panel-frame-bg'
    ]
  },
  'icon-badge': {
    type: 'icon-badge',
    html5Tag: '<figure class="ui-badge">',
    unityUiToolkitTag: '<ui:Image>',
    unityUssClass: '.unity-image',
    badgeZh: 'Image · 独立图标徽章',
    badgeEn: 'Icon / Badge',
    folderPrefixZh: '[Icon 图标]',
    folderPrefixEn: '[Icon]',
    standardParts: ['icon-graphic']
  }
}

export function getUiControlSpec(type: UiControlType | undefined): UiControlSpecMeta {
  return UI_CONTROL_SPECS[type ?? 'panel'] ?? UI_CONTROL_SPECS.panel
}

export function formatUiPartRoleLabel(
  role: UiControlPartRole | undefined,
  locale = 'zh-CN'
): string {
  const isZh = locale.toLowerCase().startsWith('zh')
  switch (role) {
    case 'button-label':
      return isZh ? '按钮文字 (Label)' : 'Button Label'
    case 'button-icon':
      return isZh ? '按钮图标 (Icon)' : 'Button Icon'
    case 'button-bg-normal':
      return isZh ? '按钮背景·常态 (Normal BG)' : 'Button Normal BG'
    case 'button-bg-hover':
      return isZh ? '按钮背景·悬停效果 (Hover BG)' : 'Button Hover BG'
    case 'button-bg-pressed':
      return isZh ? '按钮背景·按下效果 (Pressed BG)' : 'Button Pressed BG'
    case 'slider-label':
      return isZh ? '滑块数值文字 (Label)' : 'Slider Label'
    case 'slider-thumb':
      return isZh ? '滑块手柄 (#unity-dragger)' : 'Slider Thumb (#unity-dragger)'
    case 'slider-fill':
      return isZh ? '进度填充条 (#unity-fill)' : 'Slider Fill (#unity-fill)'
    case 'slider-track':
      return isZh ? '轨道底槽 (#unity-tracker)' : 'Slider Track (#unity-tracker)'
    case 'slot-level-text':
      return isZh ? '强化等级/数量文字 (Slot Level)' : 'Slot Level Text'
    case 'slot-corner-badge':
      return isZh ? '右上角红点/品阶角标 (Corner Badge)' : 'Slot Corner Badge'
    case 'slot-item-icon':
      return isZh ? '装备/法宝主体图标 (Item Icon)' : 'Slot Item Icon'
    case 'slot-rarity-frame':
      return isZh ? '品质发光外框 (Rarity Frame)' : 'Slot Rarity Frame'
    case 'slot-bg':
      return isZh ? '装备槽凹槽底板 (Slot BG)' : 'Slot Recessed BG'
    case 'list-item-label':
      return isZh ? '列表项文字/角标 (Item Label)' : 'List Item Label'
    case 'list-item-icon':
      return isZh ? '列表项图标 (Item Icon)' : 'List Item Icon'
    case 'list-item-bg':
      return isZh ? '列表项背景槽 (Item Slot BG)' : 'List Item Slot BG'
    case 'list-scrollbar':
      return isZh ? '列表滚动条 (Scrollbar)' : 'List Scrollbar'
    case 'list-viewport-bg':
      return isZh ? '列表视口底板 (#unity-content-viewport)' : 'List Viewport BG'
    case 'tab-label':
      return isZh ? '页签文字 (Tab Label)' : 'Tab Label'
    case 'tab-item-active':
      return isZh ? '激活态页签背景 (Active Tab BG)' : 'Active Tab BG'
    case 'tab-item-inactive':
      return isZh ? '未激活页签背景 (Inactive Tab BG)' : 'Inactive Tab BG'
    case 'tab-bar-bg':
      return isZh ? '页签栏底槽 (TabBar BG)' : 'TabBar BG'
    case 'dropdown-value-text':
      return isZh ? '下拉框当前文本 (#unity-text-element)' : 'Dropdown Value Text'
    case 'dropdown-arrow':
      return isZh ? '下拉箭头图标 (.unity-base-popup-field__arrow)' : 'Dropdown Arrow Icon'
    case 'dropdown-bg':
      return isZh ? '下拉框底槽 (Dropdown BG)' : 'Dropdown Field BG'
    case 'radio-label':
      return isZh ? '单选框文字 (Radio Label)' : 'Radio Label'
    case 'radio-checkmark':
      return isZh ? '单选选中圆点 (#unity-checkmark)' : 'Radio Checkmark'
    case 'radio-bg':
      return isZh ? '单选外圈底槽 (Radio BG)' : 'Radio Ring BG'
    case 'toggle-label':
      return isZh ? '开关标签文字 (Toggle Label)' : 'Toggle Label'
    case 'toggle-checkmark':
      return isZh ? '勾选状态图标 (#unity-checkmark)' : 'Toggle Checkmark'
    case 'toggle-bg':
      return isZh ? '勾选框底槽 (Toggle BG)' : 'Toggle BG'
    case 'textfield-text':
      return isZh ? '输入框文本 (#unity-text-input)' : 'TextField Text'
    case 'textfield-icon':
      return isZh ? '输入框图标 (Input Icon)' : 'TextField Icon'
    case 'textfield-bg':
      return isZh ? '输入框底槽 (TextField BG)' : 'TextField BG'
    case 'scroller-thumb':
      return isZh ? '滚动条滑块 (#unity-dragger)' : 'Scroller Thumb (#unity-dragger)'
    case 'scroller-low-btn':
      return isZh ? '滚动条上/左微调按钮 (#unity-low-button)' : 'Scroller Low Button'
    case 'scroller-high-btn':
      return isZh ? '滚动条下/右微调按钮 (#unity-high-button)' : 'Scroller High Button'
    case 'scroller-track':
      return isZh ? '滚动条轨道底槽 (#unity-tracker)' : 'Scroller Track (#unity-tracker)'
    case 'foldout-title':
      return isZh ? '折叠栏标题文字 (Foldout Title)' : 'Foldout Title'
    case 'foldout-arrow':
      return isZh ? '折叠展开三角图标 (.unity-foldout__checkmark)' : 'Foldout Arrow'
    case 'foldout-header-bg':
      return isZh ? '折叠标题栏底板 (Foldout Header BG)' : 'Foldout Header BG'
    case 'foldout-content':
      return isZh ? '折叠展开内容区 (#unity-content)' : 'Foldout Content'
    case 'radial-center-icon':
      return isZh ? '环形中心阵眼/数值 (Radial Center)' : 'Radial Center Icon/Value'
    case 'radial-fill-ring':
      return isZh ? '发光环形进度条 (Radial Fill Ring)' : 'Radial Fill Ring'
    case 'radial-track-ring':
      return isZh ? '环形轨道底槽 (Radial Track Ring)' : 'Radial Track Ring'
    case 'hud-value-text':
      return isZh ? '状态数值文字 (HUD Value)' : 'HUD Value Text'
    case 'hud-icon':
      return isZh ? '资源/状态图标 (HUD Icon)' : 'HUD Icon'
    case 'hud-bar-bg':
      return isZh ? '状态栏底槽 (HUD Bar BG)' : 'HUD Bar BG'
    case 'panel-close-btn':
      return isZh ? '面板右上角关闭按钮 (Close Button ×)' : 'Panel Close Button'
    case 'panel-ornament':
      return isZh ? '面板边角云纹装饰 (Corner Ornament)' : 'Panel Corner Ornament'
    case 'panel-title':
      return isZh ? '面板标题文字 (Panel Title)' : 'Panel Title'
    case 'panel-header':
      return isZh ? '面板标题栏横幅 (Header Banner)' : 'Panel Header Banner'
    case 'panel-content-text':
      return isZh ? '面板正文/属性文字 (Content Text)' : 'Panel Content Text'
    case 'panel-frame-bg':
      return isZh ? '面板九宫格底框 (Panel 9-Slice Frame)' : 'Panel 9-Slice Frame BG'
    case 'canvas-base':
      return isZh ? '底层画布背景 (Canvas Base)' : 'Canvas Base'
    default:
      return isZh ? '独立图标组件 (Icon Graphic)' : 'Icon Graphic'
  }
}

export interface DecomposedControlSubPart {
  idSuffix: string
  name: string
  description: string
  uiControlType: UiControlType
  uiPartRole: UiControlPartRole
  left: number
  top: number
  width: number
  height: number
  rgba: Uint8ClampedArray
  /** 默认可见性：常态部件为 true，合成的 hover / pressed 状态图层默认 false（在 PSD 中保留为隐藏状态层） */
  visible: boolean
  nineSliceBorders?: [number, number, number, number]
  /** 原生 Photoshop 可编辑文本图层元数据（仅在文字/标签部件上自动生成） */
  editableText?: UiEditableTextMeta
}

export interface LocalOcrTextBox {
  /** 识别出的文本内容 */
  text: string
  /** 文本行/词组在画布上的像素左边界 */
  left: number
  /** 文本行/词组在画布上的像素上边界 */
  top: number
  /** 像素宽度 */
  width: number
  /** 像素高度 */
  height: number
  /** 可选置信度 (0..1) */
  confidence?: number
}

/**
 * 规范化本地 OCR 引擎（如 Windows.Media.Ocr）识别出的文本：
 * 自动剔除中文字符之间、中文与数字/加减号之间被分词器插入的多余空格，同时保留英文单词间的正常空格，
 * 并自动修复常见游戏艺术字/数字 OCR 误识别（如 `强亻包` → `强化礼包`、`xl00` → `x100`、`$ 19 · 9` → `$19.9`、`999 · 99k` → `999.99k`）。
 */
export function normalizeOcrDetectedText(rawText: string): string {
  return rawText
    .replace(/\r?\n+/g, ' ')
    .replace(/[《<]?\s*强\s*[亻イ化]?\s*[礼]?\s*包/g, '强化礼包')
    .replace(/^(?:到\s*0\s*)?礼包内容\s*[：:]?/g, '礼包内容:')
    .replace(/^[乡賣]\s*/g, '')
    .replace(/[賣]\s*(?=[0-9])/g, '')
    .replace(/\b7300000\b/g, '1300000')
    .replace(/推荐\s*区\s*(?=[0-9]+)/g, '推荐 ')
    .replace(/^0?(通过关卡\s*[0-9]+)\s*[一\-—]\s*([0-9]+)$/g, '$1-$2')
    .replace(/^行\s*证$/g, '通行证')
    .replace(/([\u3000-\u9fff\uff00-\uffef])\s+(?=[\u3000-\u9fff\uff00-\uffef])/g, '$1')
    .replace(/([\u3000-\u9fff\uff00-\uffef])\s+(?=[+\-0-9%])/g, '$1')
    .replace(/([+\-0-9%])\s+(?=[\u3000-\u9fff\uff00-\uffef])/g, '$1')
    .replace(/([+\-])\s+(?=[0-9])/g, '$1')
    .replace(/([0-9])\s*,\s*(?=[0-9])/g, '$1,')
    .replace(/([0-9])\s*[·•]\s*(?=[0-9])/g, '$1.')
    .replace(/([0-9])\s*．\s*(?=[\u4e00-\u9fff])/g, '$1.')
    .replace(/([0-9]{1,2})\s*[：:]\s*(?=[0-9]{2})/g, '$1:')
    .replace(/([$¥€£])\s+(?=[0-9])/g, '$1')
    .replace(/(?:^|\b)[×xX]\s*[lI|](?=[0-9]+)/g, 'x1')
    .replace(/(?:^|\b)[×xX]\s*(?=[0-9]+)/g, 'x')
    .replace(/^(?:[一丨|•·~_+-]+)\s+(?=[\u4e00-\u9fff]{2,})/g, '')
    .replace(/(?<=[\u4e00-\u9fff]{2,})\s+(?:[一丨|•·~_+-]+)$/g, '')
    .replace(/(?<=[$¥€£][0-9]+(?:\.[0-9]+)?)\s+[0-9]$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * 将全画布 OCR 识别出的文本框集合与指定 UI 控件/子部件矩形框进行空间交集匹配：
 * - 若提供 `excludedChildRects`（如大面板内部已剥离的子按钮矩形），自动排除落入子控件内的文字，防止子按钮文字串入父面板；
 * - 按阅读顺序（自上而下、自左向右）拼接匹配到的文本。
 */
export function matchOcrBoxesToControlRect(
  ocrBoxes: ReadonlyArray<LocalOcrTextBox> | undefined,
  rect: { left: number; top: number; width: number; height: number },
  excludedChildRects?: ReadonlyArray<{ left: number; top: number; width: number; height: number }>
): string | undefined {
  if (!ocrBoxes?.length) return undefined
  const rx0 = rect.left
  const ry0 = rect.top
  const rx1 = rect.left + rect.width
  const ry1 = rect.top + rect.height

  const matched: LocalOcrTextBox[] = []
  for (const box of ocrBoxes) {
    const clean = normalizeOcrDetectedText(box.text ?? '')
    if (!clean) continue
    const bw = Math.max(1, box.width)
    const bh = Math.max(1, box.height)
    const bx0 = box.left
    const by0 = box.top
    const bx1 = bx0 + bw
    const by1 = by0 + bh
    const bcx = bx0 + bw * 0.5
    const bcy = by0 + bh * 0.5

    const ix0 = Math.max(rx0, bx0)
    const iy0 = Math.max(ry0, by0)
    const ix1 = Math.min(rx1, bx1)
    const iy1 = Math.min(ry1, by1)
    const interArea = ix1 > ix0 && iy1 > iy0 ? (ix1 - ix0) * (iy1 - iy0) : 0
    const boxArea = bw * bh
    const centerInside = bcx >= rx0 && bcx <= rx1 && bcy >= ry0 && bcy <= ry1
    if (!centerInside && interArea < boxArea * 0.42) continue

    if (excludedChildRects?.length) {
      let insideChild = false
      for (const child of excludedChildRects) {
        const cx0 = child.left
        const cy0 = child.top
        const cx1 = child.left + child.width
        const cy1 = child.top + child.height
        if (bcx >= cx0 && bcx <= cx1 && bcy >= cy0 && bcy <= cy1) {
          insideChild = true
          break
        }
        const cix0 = Math.max(cx0, bx0)
        const ciy0 = Math.max(cy0, by0)
        const cix1 = Math.min(cx1, bx1)
        const ciy1 = Math.min(cy1, by1)
        if (cix1 > cix0 && ciy1 > ciy0 && (cix1 - cix0) * (ciy1 - ciy0) >= boxArea * 0.5) {
          insideChild = true
          break
        }
      }
      if (insideChild) continue
    }

    matched.push({ ...box, text: clean })
  }

  if (!matched.length) return undefined

  matched.sort((a, b) => {
    const cyA = a.top + a.height * 0.5
    const cyB = b.top + b.height * 0.5
    const lineTol = Math.max(a.height, b.height, 10) * 0.65
    if (Math.abs(cyA - cyB) > lineTol) return cyA - cyB
    return a.left - b.left
  })

  const joined = normalizeOcrDetectedText(matched.map((m) => m.text).join(' '))
  return joined || undefined
}

export interface RecognizedUiControlInput {
  controlId?: string
  controlType?: UiControlType
  nameHint?: string
  descriptionHint?: string
  /** VLM / OCR 识别出的画面真实文本内容（优先写入 PSD TySh 可编辑文本层） */
  ocrText?: string
  /** 可选：全画布或局部 OCR 文本框列表，支持对面板标题/正文等多文本子部件进行精确空间匹配 */
  ocrBoxes?: ReadonlyArray<LocalOcrTextBox>
  /** 若该面板容器已完成内部子控件剥离与修补，不再重复从底框提取残余正文图层 */
  alreadyPeeledContainer?: boolean
  left: number
  top: number
  width: number
  height: number
  canvasWidth: number
  canvasHeight: number
  rgba: Uint8ClampedArray
  nineSliceBorders?: [number, number, number, number]
  locale?: string
}

export interface UiVlmDetectedControlHint {
  name?: string
  description?: string
  controlType?: UiControlType
  /** 画面真实 OCR 识别出的文本（如 "祭炼升阶"、"+15"、"法宝炼器"） */
  ocrText?: string
  left: number
  top: number
  width: number
  height: number
}

/**
 * 构建多模态 VLM UI 控件结构化检测 + 真实 OCR 识字提示词：
 * 指导视觉大模型直接输出画面中所有独立 UI 控件的精确坐标框、16 类标准控件类型及真实 OCR 文本。
 */
export function buildVlmUiControlDetectionPrompt(options?: {
  locale?: string
  userHint?: string
  sourceTitle?: string
}): { system: string; prompt: string } {
  const isEn = typeof options?.locale === 'string' && /^en\b/i.test(options.locale.trim())
  const allowedTypes = Object.keys(UI_CONTROL_SPECS).join(' | ')
  const system = isEn
    ? `You are an expert Game UI & Unity UI Toolkit / HTML5 structural layout analyzer and OCR engine.
Analyze the input game UI image and detect all distinct interactive controls, HUD bars, item slots, tabs, and panels.
Return ONLY a valid JSON array (no markdown explanation) where each item has:
- "name": concise semantic name of the control (e.g. "Upgrade Button", "Weapon Slot 1", "HP Bar")
- "controlType": one of [${allowedTypes}]
- "ocrText": exact visible text inside this control (empty string "" if no text)
- "box_2d": [ymin, xmin, ymax, xmax] normalized to 0..1000 integers.`
    : `你是专业的游戏 UI 视觉结构分析器与高精度 OCR 识字引擎（遵循 HTML5 与 Unity UI Toolkit 16 类标准控件规范）。
请仔细扫描输入的 UI 界面图片，识别出画面中所有独立的交互按钮、道具装备槽、进度/滑动条、页签栏、下拉框、列表容器、顶部资源栏与弹窗面板，并准确识别每个控件上的真实文字（OCR）。
只输出合法的 JSON 数组（不要任何额外解释文本），数组每项格式严格为：
{
  "name": "控件中文语义名称（如：祭炼升阶按钮、神兵槽位1、灵力滑动条、法宝详情面板）",
  "controlType": "${allowedTypes} 之一",
  "ocrText": "该控件内部实际显示的准确文字内容（如：祭炼升阶、+12、99999；无文字则填 \"\"）",
  "box_2d": [ymin, xmin, ymax, xmax] // 0~1000 归一化整数坐标
}`

  const extra = [options?.sourceTitle?.trim(), options?.userHint?.trim()]
    .filter(Boolean)
    .join(' | ')
  const prompt = isEn
    ? `Detect up to 28 UI controls (including modal container frame, character portrait, title, promo banner, reward item slots, close button, navigation arrows, countdown timer, CTA buttons, top HUD currency bars, side entry icons, and bottom navigation tabs) and their exact OCR text in this UI screen.${extra ? ` Context: ${extra}` : ''} Output JSON array only.`
    : `请检测此界面中的全部关键 UI 控件（最多 28 个，包括弹窗主体底框、角色立绘、弹窗标题、宣传标语横幅、奖励道具槽位、关闭按钮、左右翻页箭头、倒计时、购买/操作按钮、顶部资源货币栏、左右侧边入口图标、底部导航栏页签），返回其 0~1000 归一化坐标框 box_2d、标准控件类型 controlType 以及画面上的真实 OCR 文字 ocrText。${extra ? `补充上下文：${extra}。` : ''}仅输出 JSON 数组。`

  return { system, prompt }
}

/**
 * 解析多模态 VLM 返回的 UI 控件检测 + OCR JSON 结果，转换为像素级 `UiVlmDetectedControlHint[]`。
 */
export function parseVlmUiControlDetectionResponse(
  rawText: string,
  canvasWidth: number,
  canvasHeight: number
): UiVlmDetectedControlHint[] {
  const cw = Math.max(1, Math.round(canvasWidth))
  const ch = Math.max(1, Math.round(canvasHeight))
  const trimmed = rawText?.trim() || ''
  if (!trimmed) return []

  // 提取代码块或首尾 [...] JSON 数组
  const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  const candidate = fenceMatch ? fenceMatch[1]!.trim() : trimmed
  const startBracket = candidate.indexOf('[')
  const endBracket = candidate.lastIndexOf(']')
  if (startBracket < 0 || endBracket <= startBracket) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(candidate.slice(startBracket, endBracket + 1))
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const validTypes = new Set<string>(Object.keys(UI_CONTROL_SPECS))
  const results: UiVlmDetectedControlHint[] = []

  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const rawBox =
      (Array.isArray(rec.box_2d) && rec.box_2d) ||
      (Array.isArray(rec.box2d) && rec.box2d) ||
      (Array.isArray(rec.bbox) && rec.bbox) ||
      null
    if (!rawBox || rawBox.length < 4) continue
    const n0 = Number(rawBox[0])
    const n1 = Number(rawBox[1])
    const n2 = Number(rawBox[2])
    const n3 = Number(rawBox[3])
    if (![n0, n1, n2, n3].every(Number.isFinite)) continue

    // 自动兼容 0..1 归一化小数与 0..1000 归一化整数
    const isUnitScale = Math.max(n0, n1, n2, n3) <= 1.05
    const scale = isUnitScale ? 1000 : 1
    // box_2d 约定为 [ymin, xmin, ymax, xmax]，若字段名为 bbox 则按 [xmin, ymin, xmax, ymax]
    const isXyxy =
      Array.isArray(rec.bbox) && !Array.isArray(rec.box_2d) && !Array.isArray(rec.box2d)
    const yminNorm = (isXyxy ? n1 : n0) * scale
    const xminNorm = (isXyxy ? n0 : n1) * scale
    const ymaxNorm = (isXyxy ? n3 : n2) * scale
    const xmaxNorm = (isXyxy ? n2 : n3) * scale

    const left = Math.max(
      0,
      Math.min(cw - 1, Math.round((Math.min(xminNorm, xmaxNorm) / 1000) * cw))
    )
    const top = Math.max(
      0,
      Math.min(ch - 1, Math.round((Math.min(yminNorm, ymaxNorm) / 1000) * ch))
    )
    const right = Math.max(
      left + 1,
      Math.min(cw, Math.round((Math.max(xminNorm, xmaxNorm) / 1000) * cw))
    )
    const bottom = Math.max(
      top + 1,
      Math.min(ch, Math.round((Math.max(yminNorm, ymaxNorm) / 1000) * ch))
    )
    const width = right - left
    const height = bottom - top
    if (width < 8 || height < 8) continue
    if (width >= cw * 0.96 && height >= ch * 0.96) continue

    const name = typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : undefined
    const description =
      typeof rec.description === 'string' && rec.description.trim()
        ? rec.description.trim()
        : undefined
    const ocrText =
      typeof rec.ocrText === 'string' && rec.ocrText.trim()
        ? rec.ocrText.trim()
        : typeof rec.text === 'string' && rec.text.trim()
          ? rec.text.trim()
          : undefined
    const rawType = typeof rec.controlType === 'string' ? rec.controlType.trim().toLowerCase() : ''
    const controlType: UiControlType | undefined = validTypes.has(rawType)
      ? (rawType as UiControlType)
      : undefined

    results.push({
      ...(name ? { name } : {}),
      ...(description ? { description } : {}),
      ...(controlType ? { controlType } : {}),
      ...(ocrText ? { ocrText } : {}),
      left,
      top,
      width,
      height
    })
  }

  return results
}

/**
 * 从前景笔画像素与控件名称/OCR 结果中自动测算 Photoshop 原生可编辑文本图层（`TySh`）的：
 * - 字芯填充色（`color`）与外轮廓描边色（`strokeColor` / `strokeWidth`）双层分离；
 * - 离线水平投影谷底切分（Glyph Projection Segmentation）测算字符个数 `glyphCount` 与真实字高字号；
 * - 基于笔画质心的左/中/右对齐方式与离线数字/文案回退推断。
 */
export function estimateEditableTextMeta(input: {
  foregroundRgba: Uint8ClampedArray
  width: number
  height: number
  rawName: string
  ocrText?: string
  fallbackText?: string
  align?: 'left' | 'center' | 'right'
}): UiEditableTextMeta {
  const { foregroundRgba, width, height, rawName, ocrText, fallbackText, align } = input
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))

  let coreR = 0
  let coreG = 0
  let coreB = 0
  let coreW = 0

  let edgeR = 0
  let edgeG = 0
  let edgeB = 0
  let edgeW = 0

  let allR = 0
  let allG = 0
  let allB = 0
  let allW = 0

  const colActive = new Uint8Array(w)
  let minY = h
  let maxY = -1
  let xWeightSum = 0
  let activeCount = 0

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pIdx = y * w + x
      const i = pIdx * 4
      const a = foregroundRgba[i + 3]!
      if (a < 56) continue
      const r = foregroundRgba[i]!
      const g = foregroundRgba[i + 1]!
      const b = foregroundRgba[i + 2]!
      const luma = 0.299 * r + 0.587 * g + 0.114 * b
      const weight = (a / 255) * (0.4 + luma / 255)
      allR += r * weight
      allG += g * weight
      allB += b * weight
      allW += weight

      if (a >= 88) {
        colActive[x] = 1
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        xWeightSum += x
        activeCount++
      }

      // 判断是字芯内部像素还是笔画外圈轮廓像素
      const leftA = x > 0 ? foregroundRgba[i - 4 + 3]! : 0
      const rightA = x + 1 < w ? foregroundRgba[i + 4 + 3]! : 0
      const topA = y > 0 ? foregroundRgba[i - w * 4 + 3]! : 0
      const botA = y + 1 < h ? foregroundRgba[i + w * 4 + 3]! : 0
      const isCore = a >= 160 && leftA >= 96 && rightA >= 96 && topA >= 96 && botA >= 96
      if (isCore) {
        coreR += r * weight
        coreG += g * weight
        coreB += b * weight
        coreW += weight
      } else {
        const edgeWeight = a / 255
        edgeR += r * edgeWeight
        edgeG += g * edgeWeight
        edgeB += b * edgeWeight
        edgeW += edgeWeight
      }
    }
  }

  const fillR = coreW > 0 ? coreR / coreW : allW > 0 ? allR / allW : 248
  const fillG = coreW > 0 ? coreG / coreW : allW > 0 ? allG / allW : 236
  const fillB = coreW > 0 ? coreB / coreW : allW > 0 ? allB / allW : 200
  const color: [number, number, number] = [
    Math.min(255, Math.max(0, Math.round(fillR))),
    Math.min(255, Math.max(0, Math.round(fillG))),
    Math.min(255, Math.max(0, Math.round(fillB)))
  ]

  let strokeColor: [number, number, number] | undefined
  let strokeWidth: number | undefined
  if (coreW > 0 && edgeW > 0) {
    const er = edgeR / edgeW
    const eg = edgeG / edgeW
    const eb = edgeB / edgeW
    const diff = Math.hypot(fillR - er, fillG - eg, fillB - eb)
    if (diff >= 26) {
      strokeColor = [
        Math.min(255, Math.max(0, Math.round(er))),
        Math.min(255, Math.max(0, Math.round(eg))),
        Math.min(255, Math.max(0, Math.round(eb)))
      ]
      strokeWidth = Math.max(1, Math.min(4, Math.round(h * 0.055)))
    }
  }

  // 水平投影谷底切分（统计独立字符段个数 glyphCount）
  let glyphCount = 0
  let inRun = false
  let runLen = 0
  const minGap = Math.max(1, Math.floor(h * 0.06))
  let gapLen = 0
  for (let x = 0; x < w; x++) {
    if (colActive[x]) {
      if (!inRun) {
        inRun = true
        runLen = 1
      } else {
        runLen++
      }
      gapLen = 0
    } else if (inRun) {
      gapLen++
      if (gapLen >= minGap) {
        if (runLen >= 2) glyphCount++
        inRun = false
        runLen = 0
      }
    }
  }
  if (inRun && runLen >= 2) glyphCount++

  let candidateName = rawName.replace(/^\[[^\]]+\]\s*/g, '').trim()
  // 先剥离标准部件角色后缀（如 " · 按钮文字 (Label)"、" · 强化等级文字 (+Lv)"）
  candidateName = candidateName
    .replace(
      /\s*·\s*(?:按钮文字|按钮图标|按钮背景|按下效果|悬停效果|数值文字|轨道底槽|进度填充|滑块手柄|强化等级文字|装备主体图标|品质发光边框|凹槽底板|页签文字|激活态页签|未激活页签|页签栏底槽|列表项.*|视口底板|当前选中文本|下拉.*|折叠.*|展开.*|中心阵眼.*|发光环形.*|环形轨道.*|面板.*|关闭按钮|状态数值.*|输入框.*|Button\s.*|Value\sLabel.*|Level\/Count\sText.*|Tab\sLabels.*|List\sItems.*|Selected\sValue.*|Foldout\s.*|Panel\s.*).*$/i,
      ''
    )
    .trim()
  // 若剩余名称形如 "购买按钮 · $19.9" 或 "核心宣传标语 · 1200% 超值返利"，优先提取 "·" 右侧的真实文案
  const dotIdx = candidateName.indexOf('·')
  if (dotIdx >= 0) {
    const rightSide = candidateName.slice(dotIdx + 1).trim()
    if (rightSide) candidateName = rightSide
  }
  const isGenericAutoName =
    /^(?:主面板底框|弹窗主体底板|顶栏横幅条|顶部装饰徽章|交互按钮|道具卡片槽|奖励道具槽|UI控件图标|底栏导航项|侧边入口|弹窗关闭按钮|左翻页箭头|右翻页箭头|轮播分页指示点|角色立绘|头像框|购买按钮|活动按钮|弹窗主标题|核心宣传标语|礼包内容横幅|倒计时文本|体力状态栏|金币资源栏|钻石资源栏|战力状态栏|章节标题|button|action_button|ui_widget_icon|top_header_bar|top_ornament_badge|item_slot_card|main_panel_frame)(?:_[0-9]+)?$/i.test(
      candidateName
    )
  const cleanedText = isGenericAutoName
    ? ''
    : candidateName
        .replace(
          /(?:按钮|滑动条|进度条|列表|切页栏|下拉框|单选框|开关|输入框|滚动条|折叠栏|面板|状态栏|资源栏|装备槽|道具格|道具槽|图标|徽章|底框|底板|_[0-9]+)$/gi,
          ''
        )
        .trim()

  const text = ocrText?.trim() || cleanedText || fallbackText || 'UI Text'
  const effectiveGlyphH = maxY > minY ? Math.max(10, maxY - minY + 1) : Math.round(h * 0.72)
  const fontSize = Math.max(12, Math.min(72, Math.round(Math.max(effectiveGlyphH, h * 0.68))))

  let resolvedAlign: 'left' | 'center' | 'right' = align ?? 'center'
  if (!align && activeCount >= 8 && w >= 32) {
    const centerRatio = xWeightSum / activeCount / w
    if (centerRatio < 0.36) resolvedAlign = 'left'
    else if (centerRatio > 0.64) resolvedAlign = 'right'
  }

  return {
    text,
    fontSize,
    color,
    ...(strokeColor ? { strokeColor, strokeWidth } : {}),
    ...(glyphCount > 0 ? { glyphCount } : {}),
    align: resolvedAlign,
    fontName: 'MicrosoftYaHei-Bold'
  }
}

/**
 * 识别候选 UI 区域所属的标准控件类型（融合 16 类语义提示 + 几何长宽比 + 内部环形/网格/箭头/边框像素特征）。
 */
export function recognizeUiControlType(input: {
  nameHint?: string
  descriptionHint?: string
  ocrText?: string
  left: number
  top: number
  width: number
  height: number
  canvasWidth: number
  canvasHeight: number
  rgba?: Uint8ClampedArray
}): UiControlType {
  const cw = Math.max(1, input.canvasWidth)
  const ch = Math.max(1, input.canvasHeight)
  const w = Math.max(1, input.width)
  const h = Math.max(1, input.height)
  const aspect = w / h
  const areaRatio = (w * h) / (cw * ch)
  const cy = (input.top + h / 2) / ch
  const hay =
    `${input.nameHint ?? ''} ${input.descriptionHint ?? ''} ${areaRatio <= 0.14 ? (input.ocrText ?? '') : ''}`.toLowerCase()

  // 1. 显式语义优先识别（16 类全覆盖）
  if (/立绘|portrait|character|角色形象|指示点|pagination|dots/i.test(hay)) {
    return 'icon-badge'
  }
  if (
    /radial|circle\s*progress|cooldown|cd\s*wheel|环形进度|冷却轮盘|阵法环|炼丹环|丹炉环|灵气环/i.test(
      hay
    )
  ) {
    return 'radial-progress'
  }
  if (/dropdown|select\b|combobox|popup\s*field|下拉框|下拉菜单|选择框|筛选框/i.test(hay)) {
    return 'dropdown'
  }
  if (/radio|单选框|单选按钮|灵珠选框/i.test(hay)) {
    return 'radio-button'
  }
  if (/scroller|scrollbar|滚动条|滑轨条/i.test(hay)) {
    return 'scroller'
  }
  if (/foldout|accordion|collapsible|折叠栏|折叠面板|抽屉栏|展开栏/i.test(hay)) {
    return 'foldout'
  }
  if (
    /item[\s_-]*slot|equip[\s_-]*slot|gem[\s_-]*slot|skill[\s_-]*slot|装备槽|装备格|道具格|道具槽|奖励槽|法宝槽|宝石孔|技能槽|物品格|槽位格/i.test(
      hay
    )
  ) {
    return 'item-slot'
  }
  if (/slider|滑块|滑动条|音量条|拖动条/i.test(hay)) return 'slider'
  if (/progress|进度条|经验条|血条|蓝条|灵力条|修为条|能量条|hp\b|mp\b|exp\b/i.test(hay)) {
    return aspect >= 2.6 ? 'slider' : 'progress-bar'
  }
  if (/tab[\s_-]*bar|切页栏|分栏导航栏/i.test(hay)) return 'tab-bar'
  if (/toggle|checkbox|switch|勾选|复选|开关/i.test(hay)) return 'toggle'
  if (/textfield|input|search|输入框|搜索框|文本框/i.test(hay)) return 'text-field'
  if (/list|grid|inventory|scroll|bag|列表|背包|物品栏|网格容器|材料栏/i.test(hay)) {
    return 'list-view'
  }
  if (/slot|格子|槽位/i.test(hay)) {
    return areaRatio <= 0.06 && aspect >= 0.72 && aspect <= 1.38 ? 'item-slot' : 'list-view'
  }
  if (
    /button|btn|cta|按钮|升阶|镶嵌|确认|取消|购买|领取|穿戴|突破|锻造|合成|前往|开始|关闭|祭炼|飞升|渡劫|升级|兑换|召唤/i.test(
      hay
    )
  ) {
    return 'button'
  }
  if (/hud|status bar|top bar|currency|顶栏|状态栏|资源栏|货币栏|灵石/i.test(hay)) {
    return 'hud-bar'
  }
  if (
    /panel|dialog|modal|frame|window|groupbox|面板|弹窗主体|底板|底框|属性框|展示窗|详情框/i.test(
      hay
    )
  ) {
    return 'panel'
  }

  // 2. 视觉几何与像素特征识别
  // 细长垂直条：独立滚动条 (Scroller)
  if (aspect <= 0.28 && h >= ch * 0.14 && w <= cw * 0.06) {
    return 'scroller'
  }

  // 细长水平条：检测是否存在左右进度填充跳变（Slider / ProgressBar / HUD）
  if (aspect >= 4.2 && h <= ch * 0.085 && w >= cw * 0.14) {
    if (cy <= 0.14 && w >= cw * 0.55) {
      return 'hud-bar'
    }
    if (input.rgba && hasHorizontalFillTransition(input.rgba, w, h)) {
      return 'slider'
    }
    return 'progress-bar'
  }

  // 顶部宽横幅状态栏
  if (cy <= 0.16 && aspect >= 2.8 && w >= cw * 0.35) {
    return 'hud-bar'
  }

  // 切页栏（高宽比适中偏扁长，或窄条多段分布）
  if (aspect >= 3.2 && h > ch * 0.06 && h <= ch * 0.13 && w >= cw * 0.32) {
    return 'tab-bar'
  }

  // 近正方形区域：检测是否为环形进度轮盘 (RadialProgress) 或 装备道具槽 (ItemSlot)
  if (aspect >= 0.75 && aspect <= 1.32 && areaRatio >= 0.004 && areaRatio <= 0.085) {
    if (input.rgba && hasRadialRingSignature(input.rgba, w, h)) {
      return 'radial-progress'
    }
    if (input.rgba && hasItemSlotSignature(input.rgba, w, h)) {
      return 'item-slot'
    }
  }

  // 水平扁框：检测是否为右侧带三角箭头的下拉框 (Dropdown)
  if (
    aspect >= 2.1 &&
    aspect <= 5.5 &&
    w >= cw * 0.08 &&
    w <= cw * 0.38 &&
    h >= ch * 0.035 &&
    h <= ch * 0.095 &&
    input.rgba &&
    hasTrailingDropdownArrowSignature(input.rgba, w, h)
  ) {
    return 'dropdown'
  }

  // 按钮控件（典型长宽比 1.45 ~ 4.8，尺寸适中）
  if (
    aspect >= 1.45 &&
    aspect <= 4.8 &&
    w >= cw * 0.06 &&
    w <= cw * 0.42 &&
    h >= ch * 0.045 &&
    h <= ch * 0.18 &&
    areaRatio <= 0.09
  ) {
    return 'button'
  }

  // 小型方形/近方形组件默认识别为独立图标或徽章（避免将侧边栏/底栏图标误识别为 Toggle 勾选框）
  if (aspect >= 0.75 && aspect <= 1.45 && areaRatio >= 0.001 && areaRatio <= 0.028) {
    return 'icon-badge'
  }

  // 大面积区域：区分列表网格容器（ListView）与常规属性/立绘面板（Panel）
  if (areaRatio >= 0.09) {
    if (input.rgba && hasRepeatingGridOrRowPattern(input.rgba, w, h)) {
      return 'list-view'
    }
    return 'panel'
  }

  if (areaRatio >= 0.025) {
    return aspect >= 1.35 ? 'button' : 'item-slot'
  }

  return 'icon-badge'
}

/**
 * 检测近正方形区域是否呈现明显的「同心圆环高亮 + 四角低亮/透明」极坐标环形进度条特征。
 */
function hasRadialRingSignature(rgba: Uint8ClampedArray, width: number, height: number): boolean {
  if (width < 28 || height < 28) return false
  const cx = width / 2
  const cy = height / 2
  const maxR = Math.min(cx, cy)
  let ringLumaSum = 0
  let ringCount = 0
  let cornerLumaSum = 0
  let cornerCount = 0
  let midGapLumaSum = 0
  let midGapCount = 0

  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const rNorm = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / maxR
      const idx = (y * width + x) * 4
      const a = rgba[idx + 3]!
      const luma = a < 32 ? 0 : 0.299 * rgba[idx]! + 0.587 * rgba[idx + 1]! + 0.114 * rgba[idx + 2]!
      if (rNorm >= 0.68 && rNorm <= 0.92) {
        ringLumaSum += luma
        ringCount++
      } else if (rNorm >= 0.42 && rNorm <= 0.58) {
        midGapLumaSum += luma
        midGapCount++
      } else if (rNorm >= 1.08) {
        cornerLumaSum += luma
        cornerCount++
      }
    }
  }
  if (!ringCount || !cornerCount || !midGapCount) return false
  const ringMean = ringLumaSum / ringCount
  const cornerMean = cornerLumaSum / cornerCount
  const midGapMean = midGapLumaSum / midGapCount
  return ringMean - cornerMean >= 32 && ringMean - midGapMean >= 18
}

/**
 * 检测近正方形区域是否具备「外圈闭合品质边框 + 内圈凹槽 + 中心图标」的装备槽 (ItemSlot) 特征。
 */
function hasItemSlotSignature(rgba: Uint8ClampedArray, width: number, height: number): boolean {
  if (width < 28 || height < 28) return false
  const borderBand = Math.max(2, Math.round(Math.min(width, height) * 0.1))
  let borderLuma = 0
  let borderN = 0
  let recessLuma = 0
  let recessN = 0
  let centerLuma = 0
  let centerN = 0

  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const idx = (y * width + x) * 4
      if (rgba[idx + 3]! < 40) continue
      const luma = 0.299 * rgba[idx]! + 0.587 * rgba[idx + 1]! + 0.114 * rgba[idx + 2]!
      const distEdge = Math.min(x, y, width - 1 - x, height - 1 - y)
      if (distEdge <= borderBand) {
        borderLuma += luma
        borderN++
      } else if (distEdge <= borderBand * 2.4) {
        recessLuma += luma
        recessN++
      } else if (
        x >= width * 0.28 &&
        x <= width * 0.72 &&
        y >= height * 0.28 &&
        y <= height * 0.72
      ) {
        centerLuma += luma
        centerN++
      }
    }
  }
  if (!borderN || !recessN || !centerN) return false
  const bMean = borderLuma / borderN
  const rMean = recessLuma / recessN
  const cMean = centerLuma / centerN
  return Math.abs(bMean - rMean) >= 16 && Math.abs(cMean - rMean) >= 14
}

/**
 * 检测水平条形框是否在右侧 20% 区域存在紧凑的下拉箭头且中段存在安静间隔（Dropdown 特征）。
 */
function hasTrailingDropdownArrowSignature(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): boolean {
  if (width < 60 || height < 18) return false
  const y0 = Math.floor(height * 0.25)
  const y1 = Math.ceil(height * 0.75)
  let gapVar = 0
  let gapN = 0
  let arrowVar = 0
  let arrowN = 0
  for (let y = y0; y < y1; y++) {
    for (let x = Math.floor(width * 0.66); x < Math.floor(width * 0.8); x++) {
      const idx = (y * width + x) * 4
      const prev = (y * width + x - 1) * 4
      gapVar +=
        Math.abs(rgba[idx]! - rgba[prev]!) +
        Math.abs(rgba[idx + 1]! - rgba[prev + 1]!) +
        Math.abs(rgba[idx + 2]! - rgba[prev + 2]!)
      gapN++
    }
    for (let x = Math.floor(width * 0.82); x < Math.floor(width * 0.94); x++) {
      const idx = (y * width + x) * 4
      const prev = (y * width + x - 1) * 4
      arrowVar +=
        Math.abs(rgba[idx]! - rgba[prev]!) +
        Math.abs(rgba[idx + 1]! - rgba[prev + 1]!) +
        Math.abs(rgba[idx + 2]! - rgba[prev + 2]!)
      arrowN++
    }
  }
  if (!gapN || !arrowN) return false
  return arrowVar / arrowN > (gapVar / gapN) * 2.4 && arrowVar / arrowN >= 18
}

/**
 * 检测水平条形控件内部是否存在明显的「左填充区 → 右轨道槽」色彩/亮度阶跃（Slider / ProgressBar 特征）。
 */
function hasHorizontalFillTransition(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): boolean {
  if (width < 24 || height < 6) return false
  const y0 = Math.floor(height * 0.25)
  const y1 = Math.max(y0 + 1, Math.ceil(height * 0.75))
  const colLuma = new Float32Array(width)
  const colChroma = new Float32Array(width)

  for (let x = 0; x < width; x++) {
    let lSum = 0
    let cSum = 0
    let count = 0
    for (let y = y0; y < y1; y++) {
      const idx = (y * width + x) * 4
      if (rgba[idx + 3]! < 32) continue
      const r = rgba[idx]!
      const g = rgba[idx + 1]!
      const b = rgba[idx + 2]!
      lSum += 0.299 * r + 0.587 * g + 0.114 * b
      cSum += Math.max(r, g, b) - Math.min(r, g, b)
      count++
    }
    if (count > 0) {
      colLuma[x] = lSum / count
      colChroma[x] = cSum / count
    }
  }

  const xStart = Math.floor(width * 0.15)
  const xEnd = Math.ceil(width * 0.85)
  let leftL = 0
  let leftC = 0
  let leftN = 0
  let rightL = 0
  let rightC = 0
  let rightN = 0
  const mid = Math.floor(width * 0.5)
  for (let x = xStart; x < mid; x++) {
    leftL += colLuma[x]!
    leftC += colChroma[x]!
    leftN++
  }
  for (let x = mid; x < xEnd; x++) {
    rightL += colLuma[x]!
    rightC += colChroma[x]!
    rightN++
  }
  if (!leftN || !rightN) return false
  const lDiff = Math.abs(leftL / leftN - rightL / rightN)
  const cDiff = Math.abs(leftC / leftN - rightC / rightN)
  return lDiff >= 22 || cDiff >= 24
}

/**
 * 检测大容器内部是否存在周期性重复的行/格子结构（ListView / GridView 特征）。
 */
function hasRepeatingGridOrRowPattern(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): boolean {
  if (width < 64 || height < 64) return false
  const x0 = Math.floor(width * 0.1)
  const x1 = Math.ceil(width * 0.9)
  const rowEdge = new Float32Array(height)
  for (let y = 1; y < height - 1; y++) {
    let diff = 0
    for (let x = x0; x < x1; x += 2) {
      const idx = (y * width + x) * 4
      const prev = ((y - 1) * width + x) * 4
      diff +=
        Math.abs(rgba[idx]! - rgba[prev]!) +
        Math.abs(rgba[idx + 1]! - rgba[prev + 1]!) +
        Math.abs(rgba[idx + 2]! - rgba[prev + 2]!)
    }
    rowEdge[y] = diff / Math.max(1, (x1 - x0) / 2)
  }
  let mean = 0
  for (let y = 1; y < height - 1; y++) mean += rowEdge[y]!
  mean /= Math.max(1, height - 2)
  let peaks = 0
  let lastPeakY = -20
  for (let y = Math.floor(height * 0.12); y < Math.ceil(height * 0.88); y++) {
    if (rowEdge[y]! > mean * 1.85 && y - lastPeakY >= Math.max(12, Math.floor(height * 0.12))) {
      peaks++
      lastPeakY = y
    }
  }
  return peaks >= 3
}

/**
 * 从控件 RGBA 缓冲区中分离「内部高对比度前景（文字/图标）」与「无字纯净背景底板」：
 * - 利用每一行的百分位平滑背景色（Row-wise Smooth Background Profile）建模控件渐变底色；
 * - 将偏离平滑底色的高对比度像素（文字笔画、图标纹章）通过色彩反混合（Color Unmixing）提取到独立透明图层；
 * - 升级为「同行真实纹理块采样 + 跨行连续平滑修补（Texture-Aware Row Patch Inpainting）」，
 *   从同一水平线上的非文字背景区采样真实云纹/金属肌理填入文字孔洞，彻底消除平滑色块感！
 */
export function separateInteriorForegroundAndCleanPlate(input: {
  rgba: Uint8ClampedArray
  width: number
  height: number
  /** 内缩比例（避开外框描边与圆角装饰，仅分离内部文字/图标） */
  insetRatioX?: number
  insetRatioY?: number
  /** 色彩偏离阈值（越小越灵敏） */
  contrastThreshold?: number
}): {
  foregroundRgba: Uint8ClampedArray
  foregroundBounds: { left: number; top: number; width: number; height: number } | null
  cleanPlateRgba: Uint8ClampedArray
  hasForeground: boolean
} {
  const { rgba, width, height } = input
  const total = width * height
  const foregroundRgba = new Uint8ClampedArray(total * 4)
  const cleanPlateRgba = new Uint8ClampedArray(rgba)

  const insetX = Math.max(2, Math.round(width * (input.insetRatioX ?? 0.09)))
  const insetY = Math.max(2, Math.round(height * (input.insetRatioY ?? 0.14)))
  const x0 = insetX
  const x1 = Math.max(x0 + 1, width - insetX)
  const y0 = insetY
  const y1 = Math.max(y0 + 1, height - insetY)
  const threshold = input.contrastThreshold ?? 28

  const fgMask = new Uint8Array(total)
  const rowBgR = new Float32Array(height)
  const rowBgG = new Float32Array(height)
  const rowBgB = new Float32Array(height)

  // 1) 估算每一行的平滑底板基色（取行内两侧内边缘与中位采样，排除文字笔画干扰）
  for (let y = 0; y < height; y++) {
    const samplesR: number[] = []
    const samplesG: number[] = []
    const samplesB: number[] = []
    const step = Math.max(1, Math.floor((x1 - x0) / 24))
    for (let x = x0; x < x1; x += step) {
      const idx = (y * width + x) * 4
      if (rgba[idx + 3]! < 48) continue
      samplesR.push(rgba[idx]!)
      samplesG.push(rgba[idx + 1]!)
      samplesB.push(rgba[idx + 2]!)
    }
    if (!samplesR.length) {
      rowBgR[y] = 40
      rowBgG[y] = 40
      rowBgB[y] = 48
      continue
    }
    samplesR.sort((a, b) => a - b)
    samplesG.sort((a, b) => a - b)
    samplesB.sort((a, b) => a - b)
    const mid = Math.floor(samplesR.length * 0.45)
    rowBgR[y] = samplesR[mid]!
    rowBgG[y] = samplesG[mid]!
    rowBgB[y] = samplesB[mid]!
  }

  // 2) 在内缩区检测高对比文字/图标像素并执行软抠图反混合
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  let fgPixelCount = 0

  for (let y = y0; y < y1; y++) {
    const br = rowBgR[y]!
    const bg = rowBgG[y]!
    const bb = rowBgB[y]!
    const bgLuma = 0.299 * br + 0.587 * bg + 0.114 * bb

    for (let x = x0; x < x1; x++) {
      const pIdx = y * width + x
      const idx = pIdx * 4
      const sa = rgba[idx + 3]!
      if (sa < 48) continue
      const sr = rgba[idx]!
      const sg = rgba[idx + 1]!
      const sb = rgba[idx + 2]!
      const sLuma = 0.299 * sr + 0.587 * sg + 0.114 * sb

      const dr = Math.abs(sr - br)
      const dg = Math.abs(sg - bg)
      const db = Math.abs(sb - bb)
      const lumaDiff = Math.abs(sLuma - bgLuma)
      const colorDiff = Math.max(dr, dg, db) + 0.25 * (dr + dg + db)
      const score = Math.max(lumaDiff * 1.15, colorDiff)

      if (score >= threshold) {
        fgMask[pIdx] = 1
        const rawAlpha = Math.min(1, Math.max(0.18, (score - threshold * 0.55) / 36))
        const outA = Math.round(rawAlpha * sa)
        const aNorm = Math.max(0.2, outA / 255)
        foregroundRgba[idx] = Math.min(
          255,
          Math.max(0, Math.round((sr - (1 - aNorm) * br) / aNorm))
        )
        foregroundRgba[idx + 1] = Math.min(
          255,
          Math.max(0, Math.round((sg - (1 - aNorm) * bg) / aNorm))
        )
        foregroundRgba[idx + 2] = Math.min(
          255,
          Math.max(0, Math.round((sb - (1 - aNorm) * bb) / aNorm))
        )
        foregroundRgba[idx + 3] = outA

        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
        fgPixelCount++
      }
    }
  }

  const interiorArea = Math.max(1, (x1 - x0) * (y1 - y0))
  const hasForeground = fgPixelCount >= Math.max(4, Math.floor(interiorArea * 0.008))
  if (!hasForeground) {
    return {
      foregroundRgba,
      foregroundBounds: null,
      cleanPlateRgba,
      hasForeground: false
    }
  }

  // 3) 对被提取的前景笔画做 1px 膨胀掩码后，执行「2D 四向逆距离调和插值 + 各向同性扩散 + 2D 真实纹理块迁移」
  const repairMask = new Uint8Array(total)
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const pIdx = y * width + x
      if (fgMask[pIdx]) {
        repairMask[pIdx] = 1
        if (x > x0) repairMask[pIdx - 1] = 1
        if (x + 1 < x1) repairMask[pIdx + 1] = 1
        if (y > y0) repairMask[pIdx - width] = 1
        if (y + 1 < y1) repairMask[pIdx + width] = 1
      }
    }
  }

  // 预计算每个掩码像素在左/右/上/下四个方向上最近的非掩码干净背景坐标
  const leftCleanX = new Int16Array(total)
  const rightCleanX = new Int16Array(total)
  const topCleanY = new Int16Array(total)
  const botCleanY = new Int16Array(total)
  const cleanPixels: number[] = []

  for (let y = y0; y < y1; y++) {
    let lastClean = Math.max(0, x0 - 1)
    for (let x = x0; x < x1; x++) {
      const pIdx = y * width + x
      if (!repairMask[pIdx]) {
        lastClean = x
        if (rgba[pIdx * 4 + 3]! >= 96) cleanPixels.push(pIdx)
      }
      leftCleanX[pIdx] = lastClean
    }
    let nextClean = Math.min(width - 1, x1)
    for (let x = x1 - 1; x >= x0; x--) {
      const pIdx = y * width + x
      if (!repairMask[pIdx]) {
        nextClean = x
      }
      rightCleanX[pIdx] = nextClean
    }
  }

  for (let x = x0; x < x1; x++) {
    let lastClean = Math.max(0, y0 - 1)
    for (let y = y0; y < y1; y++) {
      const pIdx = y * width + x
      if (!repairMask[pIdx]) {
        lastClean = y
      }
      topCleanY[pIdx] = lastClean
    }
    let nextClean = Math.min(height - 1, y1)
    for (let y = y1 - 1; y >= y0; y--) {
      const pIdx = y * width + x
      if (!repairMask[pIdx]) {
        nextClean = y
      }
      botCleanY[pIdx] = nextClean
    }
  }

  // Pass 1：2D 四向逆距离调和插值（上下邻域距离短、权重高，彻底消除单行拉丝伪影）
  for (let y = y0; y < y1; y++) {
    const br = rowBgR[y]!
    const bg = rowBgG[y]!
    const bb = rowBgB[y]!
    for (let x = x0; x < x1; x++) {
      const pIdx = y * width + x
      if (!repairMask[pIdx]) continue

      const lx = leftCleanX[pIdx]!
      const rx = rightCleanX[pIdx]!
      const ty = topCleanY[pIdx]!
      const by = botCleanY[pIdx]!

      const dL = Math.max(1, x - lx)
      const dR = Math.max(1, rx - x)
      const dT = Math.max(1, y - ty)
      const dB = Math.max(1, by - y)

      const wL = 1 / Math.pow(dL, 1.35)
      const wR = 1 / Math.pow(dR, 1.35)
      const wT = 1.35 / Math.pow(dT, 1.35)
      const wB = 1.35 / Math.pow(dB, 1.35)
      const wSum = wL + wR + wT + wB

      const lIdx = (y * width + lx) * 4
      const rIdx = (y * width + rx) * 4
      const tIdx = (ty * width + x) * 4
      const bIdx = (by * width + x) * 4

      const harmR =
        (rgba[lIdx]! * wL + rgba[rIdx]! * wR + rgba[tIdx]! * wT + rgba[bIdx]! * wB) / wSum
      const harmG =
        (rgba[lIdx + 1]! * wL +
          rgba[rIdx + 1]! * wR +
          rgba[tIdx + 1]! * wT +
          rgba[bIdx + 1]! * wB) /
        wSum
      const harmB =
        (rgba[lIdx + 2]! * wL +
          rgba[rIdx + 2]! * wR +
          rgba[tIdx + 2]! * wT +
          rgba[bIdx + 2]! * wB) /
        wSum

      const dst = pIdx * 4
      cleanPlateRgba[dst] = Math.round(harmR * 0.78 + br * 0.22)
      cleanPlateRgba[dst + 1] = Math.round(harmG * 0.78 + bg * 0.22)
      cleanPlateRgba[dst + 2] = Math.round(harmB * 0.78 + bb * 0.22)
    }
  }

  // Pass 2：2 轮 2D 3×3 各向同性扩散平滑（消除四向交界折痕）
  const tempPlate = new Uint8ClampedArray(cleanPlateRgba)
  for (let iter = 0; iter < 2; iter++) {
    tempPlate.set(cleanPlateRgba)
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const pIdx = y * width + x
        if (!repairMask[pIdx]) continue
        let rAcc = 0
        let gAcc = 0
        let bAcc = 0
        let wAcc = 0
        for (let dy = -1; dy <= 1; dy++) {
          const ny = Math.min(height - 1, Math.max(0, y + dy))
          for (let dx = -1; dx <= 1; dx++) {
            const nx = Math.min(width - 1, Math.max(0, x + dx))
            const nWeight = dx === 0 && dy === 0 ? 2 : dx === 0 || dy === 0 ? 1 : 0.7
            const nIdx = (ny * width + nx) * 4
            rAcc += tempPlate[nIdx]! * nWeight
            gAcc += tempPlate[nIdx + 1]! * nWeight
            bAcc += tempPlate[nIdx + 2]! * nWeight
            wAcc += nWeight
          }
        }
        const dst = pIdx * 4
        cleanPlateRgba[dst] = Math.round(rAcc / wAcc)
        cleanPlateRgba[dst + 1] = Math.round(gAcc / wAcc)
        cleanPlateRgba[dst + 2] = Math.round(bAcc / wAcc)
      }
    }
  }

  // Pass 3：对称镜像与 3×3 块匹配纹理合成（Symmetric Mirror + 3×3 PatchMatch Exemplar Synthesis）
  // 优先匹配水平对称位置（还原对称暗纹/浮雕/龙凤纹章）及同梯度行 3×3 最小 SSD 干净样本块
  if (cleanPixels.length >= 4) {
    tempPlate.set(cleanPlateRgba)
    for (let y = y0; y < y1; y++) {
      const rowP = y * width
      for (let x = x0; x < x1; x++) {
        const pIdx = rowP + x
        if (!repairMask[pIdx]) continue

        const lx = Math.max(0, leftCleanX[pIdx]! - ((x - leftCleanX[pIdx]!) % 3))
        const rx = Math.min(width - 1, rightCleanX[pIdx]! + ((rightCleanX[pIdx]! - x) % 3))
        const mx = width - 1 - x

        const candidates = [
          rowP + mx,
          rowP + lx,
          rowP + rx,
          cleanPixels[(x * 7 + y * 13) % cleanPixels.length]!,
          cleanPixels[(x * 17 + y * 31 + 5) % cleanPixels.length]!
        ]

        let bestPIdx = candidates[3]!
        let bestScore = Number.POSITIVE_INFINITY
        let bestIsMirror = false

        for (let c = 0; c < candidates.length; c++) {
          const candPIdx = candidates[c]!
          if (candPIdx < 0 || candPIdx >= total || repairMask[candPIdx]) continue
          const cRgbaIdx = candPIdx * 4
          if (rgba[cRgbaIdx + 3]! < 96) continue
          const cy = Math.floor(candPIdx / width)
          const cx = candPIdx - cy * width

          // 计算 3×3 邻域结构 SSD（对比 guide 邻域与候选块邻域）
          let ssd = Math.abs(cy - y) * 6
          for (let dy = -1; dy <= 1; dy += 2) {
            const gNy = Math.min(height - 1, Math.max(0, y + dy))
            const cNy = Math.min(height - 1, Math.max(0, cy + dy))
            for (let dx = -1; dx <= 1; dx += 2) {
              const gNx = Math.min(width - 1, Math.max(0, x + dx))
              const cNx = Math.min(width - 1, Math.max(0, cx + (c === 0 ? -dx : dx)))
              const gIdx = (gNy * width + gNx) * 4
              const sIdx = (cNy * width + cNx) * 4
              ssd +=
                Math.abs(tempPlate[gIdx]! - rgba[sIdx]!) +
                Math.abs(tempPlate[gIdx + 1]! - rgba[sIdx + 1]!) +
                Math.abs(tempPlate[gIdx + 2]! - rgba[sIdx + 2]!)
            }
          }
          if (c === 0) ssd *= 0.82 // 水平对称位置赋予先验优先权
          if (ssd < bestScore) {
            bestScore = ssd
            bestPIdx = candPIdx
            bestIsMirror = c === 0
          }
        }

        const sampleY = Math.floor(bestPIdx / width)
        const sIdx = bestPIdx * 4
        const texDeltaR = rgba[sIdx]! - rowBgR[sampleY]!
        const texDeltaG = rgba[sIdx + 1]! - rowBgG[sampleY]!
        const texDeltaB = rgba[sIdx + 2]! - rowBgB[sampleY]!
        const blendGain = bestIsMirror ? 0.68 : 0.48
        const dst = pIdx * 4
        cleanPlateRgba[dst] = Math.min(
          255,
          Math.max(0, Math.round(tempPlate[dst]! + texDeltaR * blendGain))
        )
        cleanPlateRgba[dst + 1] = Math.min(
          255,
          Math.max(0, Math.round(tempPlate[dst + 1]! + texDeltaG * blendGain))
        )
        cleanPlateRgba[dst + 2] = Math.min(
          255,
          Math.max(0, Math.round(tempPlate[dst + 2]! + texDeltaB * blendGain))
        )
      }
    }
  }

  return {
    foregroundRgba,
    foregroundBounds: {
      left: minX,
      top: minY,
      width: Math.max(1, maxX - minX + 1),
      height: Math.max(1, maxY - minY + 1)
    },
    cleanPlateRgba,
    hasForeground: true
  }
}

/**
 * 裁剪子矩形 RGBA 缓冲区。
 */
function cropSubRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  rect: { left: number; top: number; width: number; height: number }
): Uint8ClampedArray {
  const cw = Math.max(1, Math.min(width - rect.left, rect.width))
  const ch = Math.max(1, Math.min(height - rect.top, rect.height))
  const out = new Uint8ClampedArray(cw * ch * 4)
  for (let y = 0; y < ch; y++) {
    const sy = rect.top + y
    if (sy < 0 || sy >= height) continue
    for (let x = 0; x < cw; x++) {
      const sx = rect.left + x
      if (sx < 0 || sx >= width) continue
      const sIdx = (sy * width + sx) * 4
      const dIdx = (y * cw + x) * 4
      out[dIdx] = rgba[sIdx]!
      out[dIdx + 1] = rgba[sIdx + 1]!
      out[dIdx + 2] = rgba[sIdx + 2]!
      out[dIdx + 3] = rgba[sIdx + 3]!
    }
  }
  return out
}

/**
 * 基于干净的按钮常态底板生成「按下态（Pressed / :active）」与「悬停态（Hover / :hover）」效果图层：
 * - Pressed：整体明度压暗 18% + 顶部内凹阴影（Inner Shadow Bevel）+ 底部微反光 + 向下沉降质感
 * - Hover：整体明度提亮 14% + 边缘暖金高光增益
 */
export function synthesizeButtonStateBuffers(
  normalPlateRgba: Uint8ClampedArray,
  width: number,
  height: number
): {
  pressedRgba: Uint8ClampedArray
  hoverRgba: Uint8ClampedArray
} {
  const pressedRgba = new Uint8ClampedArray(width * height * 4)
  const hoverRgba = new Uint8ClampedArray(width * height * 4)
  const bevelTopRows = Math.max(2, Math.round(height * 0.22))

  for (let y = 0; y < height; y++) {
    // 按下态下移 1px 采样以呈现真实物理按压位移感
    const srcY = y > 0 ? y - 1 : 0
    const topBevelFactor = y < bevelTopRows ? 0.72 + 0.14 * (y / bevelTopRows) : 0.84
    const hoverFactor = y < height * 0.5 ? 1.18 : 1.1

    for (let x = 0; x < width; x++) {
      const dstIdx = (y * width + x) * 4
      const srcIdx = (srcY * width + x) * 4
      const curIdx = (y * width + x) * 4

      const pr = normalPlateRgba[srcIdx]!
      const pg = normalPlateRgba[srcIdx + 1]!
      const pb = normalPlateRgba[srcIdx + 2]!
      const pa = normalPlateRgba[srcIdx + 3]!

      pressedRgba[dstIdx] = Math.min(255, Math.max(0, Math.round(pr * topBevelFactor)))
      pressedRgba[dstIdx + 1] = Math.min(255, Math.max(0, Math.round(pg * topBevelFactor)))
      pressedRgba[dstIdx + 2] = Math.min(255, Math.max(0, Math.round(pb * topBevelFactor)))
      pressedRgba[dstIdx + 3] = pa

      const hr = normalPlateRgba[curIdx]!
      const hg = normalPlateRgba[curIdx + 1]!
      const hb = normalPlateRgba[curIdx + 2]!
      const ha = normalPlateRgba[curIdx + 3]!
      hoverRgba[dstIdx] = Math.min(255, Math.round(hr * hoverFactor + 8))
      hoverRgba[dstIdx + 1] = Math.min(255, Math.round(hg * hoverFactor + 6))
      hoverRgba[dstIdx + 2] = Math.min(255, Math.round(hb * hoverFactor + 2))
      hoverRgba[dstIdx + 3] = ha
    }
  }

  return { pressedRgba, hoverRgba }
}

/**
 * 将单个已识别的 UI 控件按 HTML5 / Unity UI Toolkit 标准控件规范拆解为结构化子部件图层序列（由底到顶排序）。
 * 若 `input.ocrText` 或 `input.ocrBoxes` 提供（来自本地离线 OCR 引擎或多模态 VLM 真实 OCR 识字），自动将其注入控件的文字子图层 `editableText` 中。
 */
export function decomposeControlIntoStandardParts(
  input: RecognizedUiControlInput
): DecomposedControlSubPart[] {
  const parts = decomposeControlIntoStandardPartsCore(input)
  const controlLevelOcr =
    input.ocrText?.trim() ||
    matchOcrBoxesToControlRect(input.ocrBoxes, {
      left: input.left,
      top: input.top,
      width: input.width,
      height: input.height
    })

  let anySubPartMatched = false
  if (input.ocrBoxes?.length) {
    for (const part of parts) {
      if (!part.editableText) continue
      const subMatched = matchOcrBoxesToControlRect(input.ocrBoxes, {
        left: Math.max(0, part.left - 4),
        top: Math.max(0, part.top - 4),
        width: part.width + 8,
        height: part.height + 8
      })
      if (subMatched) {
        part.editableText = {
          ...part.editableText,
          text: subMatched
        }
        anySubPartMatched = true
      }
    }
  }

  if (controlLevelOcr && !anySubPartMatched) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i]!
      if (part.editableText) {
        part.editableText = {
          ...part.editableText,
          text: controlLevelOcr
        }
        break
      }
    }
  }
  return parts
}

function decomposeControlIntoStandardPartsCore(
  input: RecognizedUiControlInput
): DecomposedControlSubPart[] {
  const { width, height, left, top, rgba, nineSliceBorders } = input
  const locale = input.locale ?? 'zh-CN'
  const isZh = locale.toLowerCase().startsWith('zh')
  const controlType = input.controlType ?? recognizeUiControlType(input)
  const baseName =
    input.nameHint?.trim() ||
    (isZh ? getUiControlSpec(controlType).badgeZh : getUiControlSpec(controlType).badgeEn)

  // ── 1. Button 控件：拆分为 [按钮背景·按下态, 按钮背景·悬停态, 按钮背景·常态, 按钮图标(可选), 按钮文字(含可编辑文本)] ──
  if (controlType === 'button') {
    const isBottomNavBtn = /底栏导航项|bottom_nav/i.test(baseName)
    const isCompactIconBtn =
      width / Math.max(1, height) < 1.35 ||
      /关闭|箭头|arrow|close/i.test(baseName) ||
      isBottomNavBtn
    const separated = isCompactIconBtn
      ? {
          cleanPlateRgba: new Uint8ClampedArray(rgba),
          foregroundRgba: new Uint8ClampedArray(width * height * 4),
          hasForeground: false,
          foregroundBounds: null
        }
      : separateInteriorForegroundAndCleanPlate({
          rgba,
          width,
          height,
          insetRatioX: 0.08,
          insetRatioY: 0.14,
          contrastThreshold: 24
        })
    const { pressedRgba, hoverRgba } = synthesizeButtonStateBuffers(
      separated.cleanPlateRgba,
      width,
      height
    )
    const compactBtnText =
      input.ocrText?.trim() ||
      (isBottomNavBtn && width >= height * 1.2 ? (isZh ? '战斗' : 'Battle') : undefined)

    const parts: DecomposedControlSubPart[] = [
      {
        idSuffix: 'button-bg-pressed',
        name: isZh ? `${baseName} · 按下效果 (Pressed)` : `${baseName} · Pressed BG`,
        description: isZh
          ? 'Unity UI Toolkit :active / HTML5 button:active 按下状态图层（PSD 内默认隐藏，一键切换）'
          : 'Pressed (:active) button background state layer',
        uiControlType: 'button',
        uiPartRole: 'button-bg-pressed',
        left,
        top,
        width,
        height,
        rgba: pressedRgba,
        visible: false,
        ...(nineSliceBorders ? { nineSliceBorders } : {})
      },
      {
        idSuffix: 'button-bg-hover',
        name: isZh ? `${baseName} · 悬停效果 (Hover)` : `${baseName} · Hover BG`,
        description: isZh
          ? 'Unity UI Toolkit :hover / HTML5 button:hover 悬停高亮图层（PSD 内默认隐藏）'
          : 'Hover (:hover) button background state layer',
        uiControlType: 'button',
        uiPartRole: 'button-bg-hover',
        left,
        top,
        width,
        height,
        rgba: hoverRgba,
        visible: false,
        ...(nineSliceBorders ? { nineSliceBorders } : {})
      },
      {
        idSuffix: 'button-bg-normal',
        name: isZh ? `${baseName} · 按钮背景 (Normal BG)` : `${baseName} · Normal BG`,
        description: isZh
          ? '已剥离文字并无痕纹理修补的纯净按钮常态九宫格背景底板'
          : 'Clean text-free 9-slice button normal background plate',
        uiControlType: 'button',
        uiPartRole: 'button-bg-normal',
        left,
        top,
        width,
        height,
        rgba: separated.cleanPlateRgba,
        visible: true,
        ...(nineSliceBorders ? { nineSliceBorders } : {}),
        ...(isCompactIconBtn && compactBtnText
          ? {
              editableText: estimateEditableTextMeta({
                foregroundRgba: separated.cleanPlateRgba,
                width,
                height,
                rawName: baseName,
                ocrText: compactBtnText,
                fallbackText: compactBtnText
              })
            }
          : {})
      }
    ]

    if (separated.hasForeground && separated.foregroundBounds) {
      const fb = separated.foregroundBounds
      // 仅当按钮左侧存在明确前置图标（贴近左侧边缘，或含祭炼/图标语义，且非货币符号 $19.9）时拆出 button-icon
      const combinedTextHint = `${baseName} ${input.ocrText ?? ''}`
      const isCurrencyPriceBtn = /[$¥€£]\s*[0-9]/.test(combinedTextHint)
      if (
        !isCurrencyPriceBtn &&
        fb.width >= width * 0.42 &&
        width >= 96 &&
        fb.left <= width * 0.24
      ) {
        const iconSplitX = Math.min(
          fb.left + Math.round(height * 0.72),
          fb.left + Math.round(fb.width * 0.28)
        )
        const iconW = Math.max(1, iconSplitX - fb.left)
        const labelLeft = iconSplitX
        const labelW = Math.max(1, fb.left + fb.width - labelLeft)
        if (iconW >= 8 && labelW >= 12) {
          const iconRect = { left: fb.left, top: fb.top, width: iconW, height: fb.height }
          const labelRect = { left: labelLeft, top: fb.top, width: labelW, height: fb.height }
          const iconRgba = cropSubRgba(separated.foregroundRgba, width, height, iconRect)
          const labelRgba = cropSubRgba(separated.foregroundRgba, width, height, labelRect)
          if (hasVisiblePixels(iconRgba) && hasVisiblePixels(labelRgba)) {
            parts.push(
              {
                idSuffix: 'button-icon',
                name: isZh ? `${baseName} · 按钮图标 (Icon)` : `${baseName} · Button Icon`,
                description: isZh ? '按钮前置装饰图标图层' : 'Button leading icon layer',
                uiControlType: 'button',
                uiPartRole: 'button-icon',
                left: left + iconRect.left,
                top: top + iconRect.top,
                width: iconRect.width,
                height: iconRect.height,
                rgba: iconRgba,
                visible: true
              },
              {
                idSuffix: 'button-label',
                name: isZh ? `${baseName} · 按钮文字 (Label)` : `${baseName} · Button Label`,
                description: isZh
                  ? '从按钮背景独立分离出的透明按钮文字层（支持 PSD 原生文本编辑）'
                  : 'Isolated transparent button text label layer (editable PSD text)',
                uiControlType: 'button',
                uiPartRole: 'button-label',
                left: left + labelRect.left,
                top: top + labelRect.top,
                width: labelRect.width,
                height: labelRect.height,
                rgba: labelRgba,
                visible: true,
                editableText: estimateEditableTextMeta({
                  foregroundRgba: labelRgba,
                  width: labelRect.width,
                  height: labelRect.height,
                  rawName: baseName,
                  ocrText: input.ocrText,
                  fallbackText: isZh ? '确定' : 'Confirm'
                })
              }
            )
            return parts
          }
        }
      }

      const croppedText = cropSubRgba(separated.foregroundRgba, width, height, fb)
      parts.push({
        idSuffix: 'button-label',
        name: isZh ? `${baseName} · 按钮文字 (Label)` : `${baseName} · Button Label`,
        description: isZh
          ? '从按钮背景独立分离出的透明按钮文字层（支持 PSD 原生文本编辑）'
          : 'Isolated transparent button text label layer (editable PSD text)',
        uiControlType: 'button',
        uiPartRole: 'button-label',
        left: left + fb.left,
        top: top + fb.top,
        width: fb.width,
        height: fb.height,
        rgba: croppedText,
        visible: true,
        editableText: estimateEditableTextMeta({
          foregroundRgba: croppedText,
          width: fb.width,
          height: fb.height,
          rawName: baseName,
          ocrText: input.ocrText,
          fallbackText: isZh ? '确认' : 'Action'
        })
      })
    }

    return parts
  }

  // ── 2. Slider / ProgressBar 控件：拆分为 [轨道底槽 #unity-tracker, 进度填充 #unity-fill, 滑块手柄 #unity-dragger, 数值文字] ──
  if (controlType === 'slider' || controlType === 'progress-bar') {
    const separated = separateInteriorForegroundAndCleanPlate({
      rgba,
      width,
      height,
      insetRatioX: 0.04,
      insetRatioY: 0.12,
      contrastThreshold: 32
    })
    const plate = separated.cleanPlateRgba
    const splitCol = detectSliderFillSplitColumn(plate, width, height)
    const fillW = Math.max(Math.round(width * 0.15), Math.min(Math.round(width * 0.88), splitCol))

    // 构建完整宽度的轨道底槽（用右侧未填充轨道采样向左平铺修补）
    const trackRgba = new Uint8ClampedArray(plate)
    const sampleStartX = Math.min(width - 2, Math.max(fillW + 2, Math.floor(width * 0.75)))
    for (let y = 0; y < height; y++) {
      const sampleX = Math.min(width - 1, sampleStartX)
      const sIdx = (y * width + sampleX) * 4
      for (let x = 0; x <= fillW; x++) {
        const dIdx = (y * width + x) * 4
        if (trackRgba[dIdx + 3]! < 16) continue
        trackRgba[dIdx] = trackRgba[sIdx]!
        trackRgba[dIdx + 1] = trackRgba[sIdx + 1]!
        trackRgba[dIdx + 2] = trackRgba[sIdx + 2]!
      }
    }

    const fillRect = { left: 0, top: 0, width: fillW, height }
    const fillRgba = cropSubRgba(plate, width, height, fillRect)

    const parts: DecomposedControlSubPart[] = [
      {
        idSuffix: 'slider-track',
        name: isZh
          ? `${baseName} · 轨道底槽 (#unity-tracker)`
          : `${baseName} · Track (#unity-tracker)`,
        description: isZh
          ? '滑动条/进度条完整空槽底板'
          : 'Full-width empty slider track background',
        uiControlType: controlType,
        uiPartRole: 'slider-track',
        left,
        top,
        width,
        height,
        rgba: trackRgba,
        visible: true,
        ...(nineSliceBorders ? { nineSliceBorders } : {})
      },
      {
        idSuffix: 'slider-fill',
        name: isZh ? `${baseName} · 进度填充 (#unity-fill)` : `${baseName} · Fill (#unity-fill)`,
        description: isZh ? '滑动条/进度条高亮填充层' : 'Active progress fill bar layer',
        uiControlType: controlType,
        uiPartRole: 'slider-fill',
        left,
        top,
        width: fillW,
        height,
        rgba: fillRgba,
        visible: true
      }
    ]

    if (controlType === 'slider') {
      const thumbSize = Math.max(12, Math.min(width, Math.round(height * 1.15)))
      const thumbLeftLocal = Math.max(
        0,
        Math.min(width - thumbSize, Math.round(fillW - thumbSize / 2))
      )
      const thumbRgba = extractOrSynthesizeSliderThumb(
        rgba,
        width,
        height,
        thumbLeftLocal,
        thumbSize
      )
      parts.push({
        idSuffix: 'slider-thumb',
        name: isZh
          ? `${baseName} · 滑块手柄 (#unity-dragger)`
          : `${baseName} · Thumb (#unity-dragger)`,
        description: isZh ? '可拖拽滑块手柄节点' : 'Draggable slider thumb handle',
        uiControlType: 'slider',
        uiPartRole: 'slider-thumb',
        left: left + thumbLeftLocal,
        top,
        width: thumbSize,
        height,
        rgba: thumbRgba,
        visible: true
      })
    }

    if (separated.hasForeground && separated.foregroundBounds) {
      const fb = separated.foregroundBounds
      const croppedLabel = cropSubRgba(separated.foregroundRgba, width, height, fb)
      parts.push({
        idSuffix: 'slider-label',
        name: isZh ? `${baseName} · 数值文字 (Label)` : `${baseName} · Value Label`,
        description: isZh ? '进度/滑动条数值文本图层' : 'Slider/ProgressBar text label layer',
        uiControlType: controlType,
        uiPartRole: 'slider-label',
        left: left + fb.left,
        top: top + fb.top,
        width: fb.width,
        height: fb.height,
        rgba: croppedLabel,
        visible: true,
        editableText: estimateEditableTextMeta({
          foregroundRgba: croppedLabel,
          width: fb.width,
          height: fb.height,
          rawName: `${Math.round((fillW / Math.max(1, width)) * 100)}%`,
          fallbackText: '65%'
        })
      })
    }

    return parts
  }

  // ── 3. ItemSlot 装备槽 / 背包道具格：5 层拆解 [凹槽底板, 品质发光外框, 装备主体图标, 右上角角标, 右下角强化等级文字] ──
  if (controlType === 'item-slot') {
    return decomposeItemSlotParts({
      rgba,
      left,
      top,
      width,
      height,
      baseName,
      isZh,
      nineSliceBorders
    })
  }

  // ── 4. TabBar 切页导航栏：按垂直投影波谷切分出 [页签栏底槽, 激活态页签, 未激活页签, 页签文字] ──
  if (controlType === 'tab-bar') {
    return decomposeTabBarParts({
      rgba,
      left,
      top,
      width,
      height,
      baseName,
      isZh,
      nineSliceBorders
    })
  }

  // ── 5. ListView / GridView 控件：拆分为 [视口底板, 滚动条(可选), 列表项背景槽, 列表项图标, 列表项文字] ──
  if (controlType === 'list-view') {
    return decomposeListViewParts({
      rgba,
      left,
      top,
      width,
      height,
      baseName,
      isZh,
      nineSliceBorders
    })
  }

  // ── 6. Dropdown 下拉选择框：拆分为 [下拉框净底槽, 右侧下拉箭头图标, 当前选中文本] ──
  if (controlType === 'dropdown') {
    return decomposeDropdownParts({
      rgba,
      left,
      top,
      width,
      height,
      baseName,
      isZh,
      nineSliceBorders
    })
  }

  // ── 7. RadioButton / Toggle 单选与勾选开关：拆分为 [选框底槽, 选中圆点/勾号, 选项标签文字] ──
  if (controlType === 'radio-button' || controlType === 'toggle') {
    return decomposeToggleOrRadioParts({
      controlType,
      rgba,
      left,
      top,
      width,
      height,
      baseName,
      isZh,
      nineSliceBorders
    })
  }

  // ── 8. Scroller 独立滚动条：拆分为 [滚动轨道底槽, 顶端微调按钮, 底端微调按钮, 滚动滑块] ──
  if (controlType === 'scroller') {
    return decomposeScrollerParts({
      rgba,
      left,
      top,
      width,
      height,
      baseName,
      isZh,
      nineSliceBorders
    })
  }

  // ── 9. Foldout 可折叠抽屉：拆分为 [展开内容区, 折叠标题栏底板, 展开三角箭头, 折叠标题文字] ──
  if (controlType === 'foldout') {
    return decomposeFoldoutParts({
      rgba,
      left,
      top,
      width,
      height,
      baseName,
      isZh,
      nineSliceBorders
    })
  }

  // ── 10. RadialProgress 环形进度条 / 技能冷却轮盘：极坐标拆分为 [外环轨道底槽, 发光环形进度, 中心阵眼图标/数值] ──
  if (controlType === 'radial-progress') {
    return decomposeRadialProgressParts({
      rgba,
      left,
      top,
      width,
      height,
      baseName,
      isZh
    })
  }

  // ── 11. HUDStatusBar / TextField：拆分为 [底槽背景, 前置图标(可选), 文字层(含可编辑文本)] ──
  if (controlType === 'hud-bar' || controlType === 'text-field') {
    const separated = separateInteriorForegroundAndCleanPlate({
      rgba,
      width,
      height,
      insetRatioX: 0.05,
      insetRatioY: 0.12,
      contrastThreshold: 26
    })
    const bgRole: UiControlPartRole = controlType === 'hud-bar' ? 'hud-bar-bg' : 'textfield-bg'
    const textRole: UiControlPartRole =
      controlType === 'hud-bar' ? 'hud-value-text' : 'textfield-text'

    const parts: DecomposedControlSubPart[] = [
      {
        idSuffix: bgRole,
        name: `${baseName} · ${formatUiPartRoleLabel(bgRole, locale)}`,
        description: formatUiPartRoleLabel(bgRole, locale),
        uiControlType: controlType,
        uiPartRole: bgRole,
        left,
        top,
        width,
        height,
        rgba: separated.cleanPlateRgba,
        visible: true,
        ...(nineSliceBorders ? { nineSliceBorders } : {})
      }
    ]
    if (separated.hasForeground && separated.foregroundBounds) {
      const fb = separated.foregroundBounds
      const croppedText = cropSubRgba(separated.foregroundRgba, width, height, fb)
      parts.push({
        idSuffix: textRole,
        name: `${baseName} · ${formatUiPartRoleLabel(textRole, locale)}`,
        description: formatUiPartRoleLabel(textRole, locale),
        uiControlType: controlType,
        uiPartRole: textRole,
        left: left + fb.left,
        top: top + fb.top,
        width: fb.width,
        height: fb.height,
        rgba: croppedText,
        visible: true,
        editableText: estimateEditableTextMeta({
          foregroundRgba: croppedText,
          width: fb.width,
          height: fb.height,
          rawName: baseName,
          fallbackText: controlType === 'hud-bar' ? '99,999' : 'Input'
        })
      })
    }
    return parts
  }

  // ── 12. Panel / GroupBox / Dialog：拆分为 [面板九宫格底框, 右上角关闭按钮(可选), 面板标题文字, 面板正文词条文字] ──
  if (controlType === 'panel') {
    const workingRgba = new Uint8ClampedArray(rgba)
    let closeBtnPart: DecomposedControlSubPart | null = null

    // 自动检测面板右上角是否存在高对比度关闭按钮 (×)（若尚未在父子结构剥离阶段拆出）
    if (!input.alreadyPeeledContainer && width >= 96 && height >= 80) {
      const cbSize = Math.max(18, Math.min(48, Math.round(Math.min(width, height) * 0.12)))
      const cbLeft = Math.max(0, width - cbSize - Math.round(width * 0.03))
      const cbTop = Math.max(0, Math.round(height * 0.03))
      const cbRect = { left: cbLeft, top: cbTop, width: cbSize, height: cbSize }
      if (hasCornerCloseButtonContrast(workingRgba, width, height, cbRect)) {
        const cbRgba = cropSubRgba(workingRgba, width, height, cbRect)
        // 从工作底板中用邻域像素擦除右上角关闭按钮
        inpaintLocalRectInPlace(workingRgba, width, height, cbRect)
        closeBtnPart = {
          idSuffix: 'panel-close-btn',
          name: isZh ? `${baseName} · 关闭按钮 (Close ×)` : `${baseName} · Close Button`,
          description: isZh ? '面板右上角独立关闭按钮组件' : 'Panel top-right close button',
          uiControlType: 'panel',
          uiPartRole: 'panel-close-btn',
          left: left + cbRect.left,
          top: top + cbRect.top,
          width: cbRect.width,
          height: cbRect.height,
          rgba: cbRgba,
          visible: true
        }
      }
    }

    const separated = separateInteriorForegroundAndCleanPlate({
      rgba: workingRgba,
      width,
      height,
      insetRatioX: 0.06,
      insetRatioY: 0.06,
      contrastThreshold: 26
    })
    const parts: DecomposedControlSubPart[] = [
      {
        idSuffix: 'panel-frame-bg',
        name: isZh ? `${baseName} · 面板九宫格底框 (Frame BG)` : `${baseName} · Panel Frame BG`,
        description: isZh
          ? '已擦除内部标题与正文词条的纯净面板九宫格底板'
          : 'Clean 9-slice panel frame background with interior text removed',
        uiControlType: 'panel',
        uiPartRole: 'panel-frame-bg',
        left,
        top,
        width,
        height,
        rgba: separated.cleanPlateRgba,
        visible: true,
        ...(nineSliceBorders ? { nineSliceBorders } : {})
      }
    ]

    if (closeBtnPart) {
      parts.push(closeBtnPart)
    }

    // 若该大面板已通过父子容器深度剥离提取出内部独立标题、标语、槽位与立绘，不再重复从底板修补残余生成冗余正文层
    if (input.alreadyPeeledContainer) {
      return parts
    }

    if (separated.hasForeground && separated.foregroundBounds) {
      const fb = separated.foregroundBounds
      const headerZoneH = Math.round(height * 0.22)
      if (fb.top < headerZoneH && fb.top + fb.height > headerZoneH + 16 && height >= 120) {
        const titleRect = {
          left: fb.left,
          top: fb.top,
          width: fb.width,
          height: Math.max(1, headerZoneH - fb.top)
        }
        const bodyRect = {
          left: fb.left,
          top: headerZoneH,
          width: fb.width,
          height: Math.max(1, fb.top + fb.height - headerZoneH)
        }
        const titleRgba = cropSubRgba(separated.foregroundRgba, width, height, titleRect)
        const bodyRgba = cropSubRgba(separated.foregroundRgba, width, height, bodyRect)
        if (hasVisiblePixels(titleRgba)) {
          parts.push({
            idSuffix: 'panel-title',
            name: isZh ? `${baseName} · 面板标题文字 (Title)` : `${baseName} · Panel Title`,
            description: isZh
              ? '面板顶部标题文字层（支持 PSD 原生文本编辑）'
              : 'Panel header title text layer',
            uiControlType: 'panel',
            uiPartRole: 'panel-title',
            left: left + titleRect.left,
            top: top + titleRect.top,
            width: titleRect.width,
            height: titleRect.height,
            rgba: titleRgba,
            visible: true,
            editableText: estimateEditableTextMeta({
              foregroundRgba: titleRgba,
              width: titleRect.width,
              height: titleRect.height,
              rawName: baseName,
              fallbackText: isZh ? '装备详情' : 'Panel Title'
            })
          })
        }
        if (hasVisiblePixels(bodyRgba)) {
          parts.push({
            idSuffix: 'panel-content-text',
            name: isZh
              ? `${baseName} · 面板正文词条 (Content Text)`
              : `${baseName} · Panel Content Text`,
            description: isZh
              ? '面板内部属性词条与正文文字层'
              : 'Panel body attributes and content text',
            uiControlType: 'panel',
            uiPartRole: 'panel-content-text',
            left: left + bodyRect.left,
            top: top + bodyRect.top,
            width: bodyRect.width,
            height: bodyRect.height,
            rgba: bodyRgba,
            visible: true,
            editableText: estimateEditableTextMeta({
              foregroundRgba: bodyRgba,
              width: bodyRect.width,
              height: bodyRect.height,
              rawName: baseName,
              fallbackText: isZh ? '属性词条 +120' : 'Attributes',
              align: 'left'
            })
          })
        }
        return parts
      }

      const contentRgba = cropSubRgba(separated.foregroundRgba, width, height, fb)
      parts.push({
        idSuffix: 'panel-content-text',
        name: isZh ? `${baseName} · 面板文字与内容 (Content)` : `${baseName} · Panel Content`,
        description: isZh ? '面板内部文字与前景内容层' : 'Panel interior text and content layer',
        uiControlType: 'panel',
        uiPartRole: 'panel-content-text',
        left: left + fb.left,
        top: top + fb.top,
        width: fb.width,
        height: fb.height,
        rgba: contentRgba,
        visible: true,
        editableText: estimateEditableTextMeta({
          foregroundRgba: contentRgba,
          width: fb.width,
          height: fb.height,
          rawName: baseName,
          fallbackText: isZh ? '面板内容' : 'Content'
        })
      })
    }
    return parts
  }

  // ── 13. 独立图标徽章 / 角色立绘 / 浮动艺术字横幅 (icon-badge) ──
  const isPureGraphicBadge = /立绘|portrait|character|角色形象|指示点|pagination|头像框/i.test(
    baseName
  )
  const explicitBadgeOcr = !isPureGraphicBadge ? input.ocrText?.trim() : undefined
  return [
    {
      idSuffix: 'icon-graphic',
      name: baseName,
      description: isZh
        ? '独立 UI 图标、徽章、立绘或横幅组件'
        : 'Standalone UI icon, badge, portrait, or banner widget',
      uiControlType: 'icon-badge',
      uiPartRole: 'icon-graphic',
      left,
      top,
      width,
      height,
      rgba,
      visible: true,
      ...(nineSliceBorders ? { nineSliceBorders } : {}),
      ...(explicitBadgeOcr
        ? {
            editableText: estimateEditableTextMeta({
              foregroundRgba: rgba,
              width,
              height,
              rawName: baseName,
              ocrText: explicitBadgeOcr,
              fallbackText: explicitBadgeOcr
            })
          }
        : {})
    }
  ]
}

/**
 * 装备槽 / 背包格子 (`item-slot`) 5 层解剖拆解：
 * `slot-bg` (凹槽净底板) + `slot-rarity-frame` (品质发光外框) + `slot-item-icon` (中心法宝/装备图标) +
 * `slot-corner-badge` (右上角红点/阶级角标) + `slot-level-text` (右下角强化等级文字)
 */
function decomposeItemSlotParts(input: {
  rgba: Uint8ClampedArray
  left: number
  top: number
  width: number
  height: number
  baseName: string
  isZh: boolean
  nineSliceBorders?: [number, number, number, number]
}): DecomposedControlSubPart[] {
  const { rgba, left, top, width, height, baseName, isZh, nineSliceBorders } = input
  const borderW = Math.max(3, Math.round(Math.min(width, height) * 0.13))
  const total = width * height

  // 1) 提取外圈品质发光边框 (slot-rarity-frame)
  const frameRgba = new Uint8ClampedArray(total * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dist = Math.min(x, y, width - 1 - x, height - 1 - y)
      if (dist <= borderW) {
        const idx = (y * width + x) * 4
        frameRgba[idx] = rgba[idx]!
        frameRgba[idx + 1] = rgba[idx + 1]!
        frameRgba[idx + 2] = rgba[idx + 2]!
        frameRgba[idx + 3] = rgba[idx + 3]!
      }
    }
  }

  // 2) 分离内部凹槽底板 (slot-bg) 与中心装备图标 (slot-item-icon)
  const separated = separateInteriorForegroundAndCleanPlate({
    rgba,
    width,
    height,
    insetRatioX: 0.14,
    insetRatioY: 0.14,
    contrastThreshold: 22
  })

  const parts: DecomposedControlSubPart[] = [
    {
      idSuffix: 'slot-bg',
      name: isZh ? `${baseName} · 凹槽底板 (Slot BG)` : `${baseName} · Slot BG`,
      description: isZh
        ? '已剥离装备图标与文字的纯净凹槽底板'
        : 'Clean recessed slot background plate',
      uiControlType: 'item-slot',
      uiPartRole: 'slot-bg',
      left,
      top,
      width,
      height,
      rgba: separated.cleanPlateRgba,
      visible: true,
      ...(nineSliceBorders ? { nineSliceBorders } : {})
    },
    {
      idSuffix: 'slot-rarity-frame',
      name: isZh ? `${baseName} · 品质发光边框 (Rarity Frame)` : `${baseName} · Rarity Frame`,
      description: isZh ? '装备槽品阶描边与外发光边框层' : 'Item slot rarity border frame',
      uiControlType: 'item-slot',
      uiPartRole: 'slot-rarity-frame',
      left,
      top,
      width,
      height,
      rgba: frameRgba,
      visible: true,
      ...(nineSliceBorders ? { nineSliceBorders } : {})
    }
  ]

  // 3) 右下角强化等级/数量角标文字 (slot-level-text) 预检测，并从图标层剥离右下角叠加数量文字
  const iconWorkSource = new Uint8ClampedArray(
    separated.hasForeground ? separated.foregroundRgba : rgba
  )
  let levelPart: DecomposedControlSubPart | null = null
  if (width >= 36 && height >= 36) {
    const lvlW = Math.max(12, Math.round(width * 0.54))
    const lvlH = Math.max(10, Math.round(height * 0.28))
    const lvlRect = {
      left: Math.max(0, width - borderW - lvlW),
      top: Math.max(0, height - borderW - lvlH),
      width: lvlW,
      height: lvlH
    }
    const lvlRgba = cropSubRgba(iconWorkSource, width, height, lvlRect)
    if (hasVisiblePixels(lvlRgba)) {
      const slotFallbackMatch = /\b([xX×+][0-9kKmM]+)\b/.exec(baseName)
      const slotFallback = slotFallbackMatch
        ? slotFallbackMatch[1]!
        : /奖励|道具槽|reward|item_slot/i.test(baseName)
          ? 'x1'
          : '+12'
      levelPart = {
        idSuffix: 'slot-level-text',
        name: isZh ? `${baseName} · 强化等级文字 (+Lv)` : `${baseName} · Level/Count Text`,
        description: isZh
          ? '装备槽右下角强化等级或叠加数量文字'
          : 'Slot bottom-right level or stack count text',
        uiControlType: 'item-slot',
        uiPartRole: 'slot-level-text',
        left: left + lvlRect.left,
        top: top + lvlRect.top,
        width: lvlRect.width,
        height: lvlRect.height,
        rgba: lvlRgba,
        visible: true,
        editableText: estimateEditableTextMeta({
          foregroundRgba: lvlRgba,
          width: lvlRect.width,
          height: lvlRect.height,
          rawName: baseName,
          fallbackText: slotFallback,
          align: 'right'
        })
      }
      // 若抹除右下角角标后中心图标仍有充足可见像素，则在 iconWorkSource 中清除该区域避免文字与图标重影
      const clearedCandidate = new Uint8ClampedArray(iconWorkSource)
      for (let y = lvlRect.top; y < lvlRect.top + lvlRect.height; y++) {
        for (let x = lvlRect.left; x < lvlRect.left + lvlRect.width; x++) {
          clearedCandidate[(y * width + x) * 4 + 3] = 0
        }
      }
      if (hasVisiblePixels(clearedCandidate)) {
        iconWorkSource.set(clearedCandidate)
      }
    }
  }

  // 4) 中心法宝/装备主体图标 (slot-item-icon)
  const iconRect = separated.foregroundBounds ?? {
    left: borderW,
    top: borderW,
    width: Math.max(1, width - borderW * 2),
    height: Math.max(1, height - borderW * 2)
  }
  const iconRgba = cropSubRgba(iconWorkSource, width, height, iconRect)
  parts.push({
    idSuffix: 'slot-item-icon',
    name: isZh ? `${baseName} · 装备主体图标 (Item Icon)` : `${baseName} · Item Icon`,
    description: isZh ? '槽位中心装备/法宝/技能主体图标' : 'Center equipment or item icon',
    uiControlType: 'item-slot',
    uiPartRole: 'slot-item-icon',
    left: left + iconRect.left,
    top: top + iconRect.top,
    width: iconRect.width,
    height: iconRect.height,
    rgba: iconRgba,
    visible: true
  })

  if (levelPart) {
    parts.push(levelPart)
  }

  return parts
}

/**
 * TabBar 切页栏子项级递归拆分：利用列投影寻找分栏间隙，拆出独立激活态页签与未激活页签。
 */
function decomposeTabBarParts(input: {
  rgba: Uint8ClampedArray
  left: number
  top: number
  width: number
  height: number
  baseName: string
  isZh: boolean
  nineSliceBorders?: [number, number, number, number]
}): DecomposedControlSubPart[] {
  const { rgba, left, top, width, height, baseName, isZh, nineSliceBorders } = input
  const separated = separateInteriorForegroundAndCleanPlate({
    rgba,
    width,
    height,
    insetRatioX: 0.04,
    insetRatioY: 0.14,
    contrastThreshold: 26
  })

  const parts: DecomposedControlSubPart[] = [
    {
      idSuffix: 'tab-bar-bg',
      name: isZh ? `${baseName} · 页签栏底槽 (TabBar BG)` : `${baseName} · TabBar BG`,
      description: isZh ? 'TabView 切页导航栏完整底槽' : 'TabView navigation bar background rail',
      uiControlType: 'tab-bar',
      uiPartRole: 'tab-bar-bg',
      left,
      top,
      width,
      height,
      rgba: separated.cleanPlateRgba,
      visible: true,
      ...(nineSliceBorders ? { nineSliceBorders } : {})
    }
  ]

  // 将页签栏按列等分或投影谷值切分为多个独立页签项，挑选亮度最高者作为 tab-item-active，其余作为 tab-item-inactive
  const tabCount = Math.max(2, Math.min(5, Math.round(width / Math.max(24, height * 2.1))))
  const segW = Math.max(12, Math.floor(width / tabCount))
  let brightestIdx = 0
  let maxLuma = -1

  for (let i = 0; i < tabCount; i++) {
    const sx = i * segW
    const sw = i === tabCount - 1 ? width - sx : segW
    let lSum = 0
    let count = 0
    for (let y = Math.floor(height * 0.2); y < Math.ceil(height * 0.8); y += 2) {
      for (let x = sx; x < sx + sw; x += 2) {
        const idx = (y * width + x) * 4
        if (separated.cleanPlateRgba[idx + 3]! < 32) continue
        lSum +=
          0.299 * separated.cleanPlateRgba[idx]! +
          0.587 * separated.cleanPlateRgba[idx + 1]! +
          0.114 * separated.cleanPlateRgba[idx + 2]!
        count++
      }
    }
    const mean = count > 0 ? lSum / count : 0
    if (mean > maxLuma) {
      maxLuma = mean
      brightestIdx = i
    }
  }

  const activeX = brightestIdx * segW
  const activeW = brightestIdx === tabCount - 1 ? width - activeX : segW
  const activeRect = { left: activeX, top: 0, width: activeW, height }
  const inactiveIdx = brightestIdx === 0 ? Math.min(1, tabCount - 1) : 0
  const inactiveX = inactiveIdx * segW
  const inactiveW = inactiveIdx === tabCount - 1 ? width - inactiveX : segW
  const inactiveRect = { left: inactiveX, top: 0, width: inactiveW, height }

  parts.push(
    {
      idSuffix: 'tab-item-inactive',
      name: isZh ? `${baseName} · 未激活页签 (Inactive Tab)` : `${baseName} · Inactive Tab BG`,
      description: isZh ? '未选中状态的普通页签背景' : 'Inactive tab item background',
      uiControlType: 'tab-bar',
      uiPartRole: 'tab-item-inactive',
      left: left + inactiveRect.left,
      top: top + inactiveRect.top,
      width: inactiveRect.width,
      height: inactiveRect.height,
      rgba: cropSubRgba(separated.cleanPlateRgba, width, height, inactiveRect),
      visible: true
    },
    {
      idSuffix: 'tab-item-active',
      name: isZh ? `${baseName} · 激活态页签 (Active Tab)` : `${baseName} · Active Tab BG`,
      description: isZh ? '当前高亮选中状态的页签背景' : 'Active selected tab item background',
      uiControlType: 'tab-bar',
      uiPartRole: 'tab-item-active',
      left: left + activeRect.left,
      top: top + activeRect.top,
      width: activeRect.width,
      height: activeRect.height,
      rgba: cropSubRgba(separated.cleanPlateRgba, width, height, activeRect),
      visible: true
    }
  )

  if (separated.hasForeground && separated.foregroundBounds) {
    const fb = separated.foregroundBounds
    const labelRgba = cropSubRgba(separated.foregroundRgba, width, height, fb)
    parts.push({
      idSuffix: 'tab-label',
      name: isZh ? `${baseName} · 页签文字 (Tab Labels)` : `${baseName} · Tab Labels`,
      description: isZh ? '切页栏文字图层（支持 PSD 原生文本编辑）' : 'Tab navigation text layer',
      uiControlType: 'tab-bar',
      uiPartRole: 'tab-label',
      left: left + fb.left,
      top: top + fb.top,
      width: fb.width,
      height: fb.height,
      rgba: labelRgba,
      visible: true,
      editableText: estimateEditableTextMeta({
        foregroundRgba: labelRgba,
        width: fb.width,
        height: fb.height,
        rawName: baseName,
        fallbackText: isZh ? '法宝 · 灵装 · 丹药' : 'Tab 1 | Tab 2'
      })
    })
  }

  return parts
}

/**
 * ListView 列表与背包网格拆解：分离视口底板、右侧滚动条（若存在）、首个单元格背景槽与列表项前景图标/文字。
 */
function decomposeListViewParts(input: {
  rgba: Uint8ClampedArray
  left: number
  top: number
  width: number
  height: number
  baseName: string
  isZh: boolean
  nineSliceBorders?: [number, number, number, number]
}): DecomposedControlSubPart[] {
  const { rgba, left, top, width, height, baseName, isZh, nineSliceBorders } = input
  const separated = separateInteriorForegroundAndCleanPlate({
    rgba,
    width,
    height,
    insetRatioX: 0.06,
    insetRatioY: 0.08,
    contrastThreshold: 28
  })

  const parts: DecomposedControlSubPart[] = [
    {
      idSuffix: 'list-viewport-bg',
      name: isZh ? `${baseName} · 视口底板 (#unity-content-viewport)` : `${baseName} · Viewport BG`,
      description: isZh
        ? 'ListView 列表滚动视口纯净底板'
        : 'ListView viewport container background',
      uiControlType: 'list-view',
      uiPartRole: 'list-viewport-bg',
      left,
      top,
      width,
      height,
      rgba: separated.cleanPlateRgba,
      visible: true,
      ...(nineSliceBorders ? { nineSliceBorders } : {})
    }
  ]

  // 提取代表性列表项槽位底框 (list-item-bg)
  if (width >= 64 && height >= 64) {
    const slotW = Math.max(24, Math.min(Math.round(width * 0.42), Math.round(height * 0.36)))
    const slotH = Math.max(24, Math.min(slotW, Math.round(height * 0.36)))
    const slotRect = {
      left: Math.round(width * 0.08),
      top: Math.round(height * 0.08),
      width: slotW,
      height: slotH
    }
    parts.push({
      idSuffix: 'list-item-bg',
      name: isZh ? `${baseName} · 列表项单元格底槽 (Item Slot BG)` : `${baseName} · Item Slot BG`,
      description: isZh
        ? '列表中单个格子/条目的复用背景槽模板'
        : 'Reusable list item slot background template',
      uiControlType: 'list-view',
      uiPartRole: 'list-item-bg',
      left: left + slotRect.left,
      top: top + slotRect.top,
      width: slotRect.width,
      height: slotRect.height,
      rgba: cropSubRgba(separated.cleanPlateRgba, width, height, slotRect),
      visible: true
    })
  }

  // 提取右侧滚动条 (list-scrollbar)
  if (width >= 80 && height >= 80) {
    const sbW = Math.max(8, Math.min(20, Math.round(width * 0.05)))
    const sbRect = {
      left: width - sbW - Math.max(2, Math.round(width * 0.02)),
      top: Math.round(height * 0.06),
      width: sbW,
      height: Math.max(16, Math.round(height * 0.88))
    }
    parts.push({
      idSuffix: 'list-scrollbar',
      name: isZh ? `${baseName} · 列表滚动条 (Scrollbar)` : `${baseName} · Scrollbar`,
      description: isZh ? '列表右侧纵向滚动条轨道与滑块' : 'ListView vertical scrollbar',
      uiControlType: 'list-view',
      uiPartRole: 'list-scrollbar',
      left: left + sbRect.left,
      top: top + sbRect.top,
      width: sbRect.width,
      height: sbRect.height,
      rgba: cropSubRgba(rgba, width, height, sbRect),
      visible: true
    })
  }

  if (separated.hasForeground && separated.foregroundBounds) {
    const fb = separated.foregroundBounds
    const fgRgba = cropSubRgba(separated.foregroundRgba, width, height, fb)
    parts.push({
      idSuffix: 'list-item-label',
      name: isZh
        ? `${baseName} · 列表项内容与文字 (Items & Labels)`
        : `${baseName} · List Items & Labels`,
      description: isZh ? '列表项图标与文本前景层' : 'ListView items and labels foreground layer',
      uiControlType: 'list-view',
      uiPartRole: 'list-item-label',
      left: left + fb.left,
      top: top + fb.top,
      width: fb.width,
      height: fb.height,
      rgba: fgRgba,
      visible: true,
      editableText: estimateEditableTextMeta({
        foregroundRgba: fgRgba,
        width: fb.width,
        height: fb.height,
        rawName: baseName,
        fallbackText: isZh ? '太虚法宝 · 阶位九' : 'List Item'
      })
    })
  }
  return parts
}

/**
 * Dropdown 下拉选择框拆解：[下拉框底槽, 右侧下拉箭头图标, 当前选中文字]
 */
function decomposeDropdownParts(input: {
  rgba: Uint8ClampedArray
  left: number
  top: number
  width: number
  height: number
  baseName: string
  isZh: boolean
  nineSliceBorders?: [number, number, number, number]
}): DecomposedControlSubPart[] {
  const { rgba, left, top, width, height, baseName, isZh, nineSliceBorders } = input
  const separated = separateInteriorForegroundAndCleanPlate({
    rgba,
    width,
    height,
    insetRatioX: 0.06,
    insetRatioY: 0.14,
    contrastThreshold: 24
  })

  const arrowW = Math.max(12, Math.min(Math.round(width * 0.22), height))
  const arrowRect = {
    left: Math.max(0, width - arrowW - Math.round(width * 0.03)),
    top: Math.round(height * 0.15),
    width: arrowW,
    height: Math.max(8, Math.round(height * 0.7))
  }
  const arrowSource = separated.hasForeground ? separated.foregroundRgba : rgba
  const arrowRgba = cropSubRgba(arrowSource, width, height, arrowRect)

  const parts: DecomposedControlSubPart[] = [
    {
      idSuffix: 'dropdown-bg',
      name: isZh ? `${baseName} · 下拉框底槽 (Dropdown BG)` : `${baseName} · Dropdown BG`,
      description: isZh ? '已剥离文字与箭头的下拉选择框净底槽' : 'Clean dropdown field background',
      uiControlType: 'dropdown',
      uiPartRole: 'dropdown-bg',
      left,
      top,
      width,
      height,
      rgba: separated.cleanPlateRgba,
      visible: true,
      ...(nineSliceBorders ? { nineSliceBorders } : {})
    },
    {
      idSuffix: 'dropdown-arrow',
      name: isZh
        ? `${baseName} · 下拉箭头 (.unity-base-popup-field__arrow)`
        : `${baseName} · Dropdown Arrow`,
      description: isZh ? '下拉框右侧展开三角箭头图标' : 'Dropdown trailing arrow icon',
      uiControlType: 'dropdown',
      uiPartRole: 'dropdown-arrow',
      left: left + arrowRect.left,
      top: top + arrowRect.top,
      width: arrowRect.width,
      height: arrowRect.height,
      rgba: arrowRgba,
      visible: true
    }
  ]

  const textRect = {
    left: Math.round(width * 0.06),
    top: Math.round(height * 0.16),
    width: Math.max(12, arrowRect.left - Math.round(width * 0.08)),
    height: Math.max(8, Math.round(height * 0.68))
  }
  const textRgba = cropSubRgba(
    separated.hasForeground ? separated.foregroundRgba : rgba,
    width,
    height,
    textRect
  )
  parts.push({
    idSuffix: 'dropdown-value-text',
    name: isZh
      ? `${baseName} · 当前选中文本 (#unity-text-element)`
      : `${baseName} · Selected Value Text`,
    description: isZh ? '下拉框当前选中项文字图层' : 'Dropdown current selected value text layer',
    uiControlType: 'dropdown',
    uiPartRole: 'dropdown-value-text',
    left: left + textRect.left,
    top: top + textRect.top,
    width: textRect.width,
    height: textRect.height,
    rgba: textRgba,
    visible: true,
    editableText: estimateEditableTextMeta({
      foregroundRgba: textRgba,
      width: textRect.width,
      height: textRect.height,
      rawName: baseName,
      fallbackText: isZh ? '全部品阶' : 'All Tiers',
      align: 'left'
    })
  })

  return parts
}

/**
 * Toggle 勾选框与 RadioButton 单选框拆解：[底槽外环/外框, 勾选/圆点图标, 标签文字]
 */
function decomposeToggleOrRadioParts(input: {
  controlType: 'toggle' | 'radio-button'
  rgba: Uint8ClampedArray
  left: number
  top: number
  width: number
  height: number
  baseName: string
  isZh: boolean
  nineSliceBorders?: [number, number, number, number]
}): DecomposedControlSubPart[] {
  const { controlType, rgba, left, top, width, height, baseName, isZh, nineSliceBorders } = input
  const isRadio = controlType === 'radio-button'
  const bgRole: UiControlPartRole = isRadio ? 'radio-bg' : 'toggle-bg'
  const markRole: UiControlPartRole = isRadio ? 'radio-checkmark' : 'toggle-checkmark'
  const labelRole: UiControlPartRole = isRadio ? 'radio-label' : 'toggle-label'

  const separated = separateInteriorForegroundAndCleanPlate({
    rgba,
    width,
    height,
    insetRatioX: 0.08,
    insetRatioY: 0.14,
    contrastThreshold: 24
  })

  const boxSize = Math.min(width, height)
  const markInset = Math.max(2, Math.round(boxSize * 0.22))
  const markRect = {
    left: markInset,
    top: Math.max(0, Math.round((height - (boxSize - markInset * 2)) / 2)),
    width: Math.max(4, boxSize - markInset * 2),
    height: Math.max(4, boxSize - markInset * 2)
  }
  const markSource = separated.hasForeground ? separated.foregroundRgba : rgba
  const markRgba = cropSubRgba(markSource, width, height, markRect)

  const parts: DecomposedControlSubPart[] = [
    {
      idSuffix: bgRole,
      name: `${baseName} · ${formatUiPartRoleLabel(bgRole, isZh ? 'zh-CN' : 'en')}`,
      description: formatUiPartRoleLabel(bgRole, isZh ? 'zh-CN' : 'en'),
      uiControlType: controlType,
      uiPartRole: bgRole,
      left,
      top,
      width,
      height,
      rgba: separated.cleanPlateRgba,
      visible: true,
      ...(nineSliceBorders ? { nineSliceBorders } : {})
    },
    {
      idSuffix: markRole,
      name: `${baseName} · ${formatUiPartRoleLabel(markRole, isZh ? 'zh-CN' : 'en')}`,
      description: formatUiPartRoleLabel(markRole, isZh ? 'zh-CN' : 'en'),
      uiControlType: controlType,
      uiPartRole: markRole,
      left: left + markRect.left,
      top: top + markRect.top,
      width: markRect.width,
      height: markRect.height,
      rgba: markRgba,
      visible: true
    }
  ]

  if (width > height * 1.35) {
    const lblLeft = Math.min(width - 8, boxSize + Math.round(height * 0.1))
    const lblRect = {
      left: lblLeft,
      top: Math.round(height * 0.12),
      width: Math.max(8, width - lblLeft),
      height: Math.max(8, Math.round(height * 0.76))
    }
    const lblRgba = cropSubRgba(
      separated.hasForeground ? separated.foregroundRgba : rgba,
      width,
      height,
      lblRect
    )
    parts.push({
      idSuffix: labelRole,
      name: `${baseName} · ${formatUiPartRoleLabel(labelRole, isZh ? 'zh-CN' : 'en')}`,
      description: formatUiPartRoleLabel(labelRole, isZh ? 'zh-CN' : 'en'),
      uiControlType: controlType,
      uiPartRole: labelRole,
      left: left + lblRect.left,
      top: top + lblRect.top,
      width: lblRect.width,
      height: lblRect.height,
      rgba: lblRgba,
      visible: true,
      editableText: estimateEditableTextMeta({
        foregroundRgba: lblRgba,
        width: lblRect.width,
        height: lblRect.height,
        rawName: baseName,
        fallbackText: isZh ? '自动祭炼' : 'Option',
        align: 'left'
      })
    })
  } else if (separated.hasForeground && separated.foregroundBounds) {
    const fb = separated.foregroundBounds
    const lblRgba = cropSubRgba(separated.foregroundRgba, width, height, fb)
    parts.push({
      idSuffix: labelRole,
      name: `${baseName} · ${formatUiPartRoleLabel(labelRole, isZh ? 'zh-CN' : 'en')}`,
      description: formatUiPartRoleLabel(labelRole, isZh ? 'zh-CN' : 'en'),
      uiControlType: controlType,
      uiPartRole: labelRole,
      left: left + fb.left,
      top: top + fb.top,
      width: fb.width,
      height: fb.height,
      rgba: lblRgba,
      visible: true,
      editableText: estimateEditableTextMeta({
        foregroundRgba: lblRgba,
        width: fb.width,
        height: fb.height,
        rawName: baseName,
        fallbackText: isZh ? '选项' : 'Option'
      })
    })
  }

  return parts
}

/**
 * Scroller 独立滚动条拆解：[轨道底槽 #unity-tracker, 顶部微调箭头 #unity-low-button, 底部微调箭头 #unity-high-button, 滑块手柄 #unity-dragger]
 */
function decomposeScrollerParts(input: {
  rgba: Uint8ClampedArray
  left: number
  top: number
  width: number
  height: number
  baseName: string
  isZh: boolean
  nineSliceBorders?: [number, number, number, number]
}): DecomposedControlSubPart[] {
  const { rgba, left, top, width, height, baseName, isZh, nineSliceBorders } = input
  const isVertical = height >= width
  const capSize = isVertical
    ? Math.min(width, Math.round(height * 0.14))
    : Math.min(height, Math.round(width * 0.14))

  const lowRect = isVertical
    ? { left: 0, top: 0, width, height: Math.max(6, capSize) }
    : { left: 0, top: 0, width: Math.max(6, capSize), height }
  const highRect = isVertical
    ? { left: 0, top: Math.max(0, height - capSize), width, height: Math.max(6, capSize) }
    : { left: Math.max(0, width - capSize), top: 0, width: Math.max(6, capSize), height }
  const thumbRect = isVertical
    ? {
        left: 0,
        top: Math.round(height * 0.25),
        width,
        height: Math.max(12, Math.round(height * 0.35))
      }
    : {
        left: Math.round(width * 0.25),
        top: 0,
        width: Math.max(12, Math.round(width * 0.35)),
        height
      }

  return [
    {
      idSuffix: 'scroller-track',
      name: isZh ? `${baseName} · 滚动轨道 (#unity-tracker)` : `${baseName} · Scroller Track`,
      description: isZh ? 'Scroller 滚动条完整背景轨道' : 'Scroller track background',
      uiControlType: 'scroller',
      uiPartRole: 'scroller-track',
      left,
      top,
      width,
      height,
      rgba,
      visible: true,
      ...(nineSliceBorders ? { nineSliceBorders } : {})
    },
    {
      idSuffix: 'scroller-low-btn',
      name: isZh ? `${baseName} · 顶端微调按钮 (#unity-low-button)` : `${baseName} · Low Button`,
      description: isZh ? '滚动条起始端箭头按钮' : 'Scroller low arrow button',
      uiControlType: 'scroller',
      uiPartRole: 'scroller-low-btn',
      left: left + lowRect.left,
      top: top + lowRect.top,
      width: lowRect.width,
      height: lowRect.height,
      rgba: cropSubRgba(rgba, width, height, lowRect),
      visible: true
    },
    {
      idSuffix: 'scroller-high-btn',
      name: isZh ? `${baseName} · 底端微调按钮 (#unity-high-button)` : `${baseName} · High Button`,
      description: isZh ? '滚动条末端箭头按钮' : 'Scroller high arrow button',
      uiControlType: 'scroller',
      uiPartRole: 'scroller-high-btn',
      left: left + highRect.left,
      top: top + highRect.top,
      width: highRect.width,
      height: highRect.height,
      rgba: cropSubRgba(rgba, width, height, highRect),
      visible: true
    },
    {
      idSuffix: 'scroller-thumb',
      name: isZh ? `${baseName} · 滚动条滑块 (#unity-dragger)` : `${baseName} · Scroller Thumb`,
      description: isZh ? 'Scroller 可拖拽滑块手柄' : 'Scroller draggable thumb',
      uiControlType: 'scroller',
      uiPartRole: 'scroller-thumb',
      left: left + thumbRect.left,
      top: top + thumbRect.top,
      width: thumbRect.width,
      height: thumbRect.height,
      rgba: cropSubRgba(rgba, width, height, thumbRect),
      visible: true
    }
  ]
}

/**
 * Foldout 可折叠抽屉拆解：[展开内容区 #unity-content, 标题栏底板, 展开三角箭头 .unity-foldout__checkmark, 折叠标题文字]
 */
function decomposeFoldoutParts(input: {
  rgba: Uint8ClampedArray
  left: number
  top: number
  width: number
  height: number
  baseName: string
  isZh: boolean
  nineSliceBorders?: [number, number, number, number]
}): DecomposedControlSubPart[] {
  const { rgba, left, top, width, height, baseName, isZh, nineSliceBorders } = input
  const headerH = Math.max(18, Math.min(Math.round(height * 0.34), 56))
  const headerRect = { left: 0, top: 0, width, height: headerH }
  const contentRect = {
    left: 0,
    top: headerH,
    width,
    height: Math.max(8, height - headerH)
  }

  const headerRaw = cropSubRgba(rgba, width, height, headerRect)
  const separatedHeader = separateInteriorForegroundAndCleanPlate({
    rgba: headerRaw,
    width,
    height: headerH,
    insetRatioX: 0.04,
    insetRatioY: 0.14,
    contrastThreshold: 24
  })

  const arrowW = Math.max(10, Math.min(headerH, Math.round(width * 0.14)))
  const arrowRect = {
    left: Math.round(width * 0.02),
    top: Math.round(headerH * 0.18),
    width: arrowW,
    height: Math.max(8, Math.round(headerH * 0.64))
  }
  const titleRect = {
    left: arrowRect.left + arrowRect.width + 4,
    top: Math.round(headerH * 0.16),
    width: Math.max(12, width - (arrowRect.left + arrowRect.width + 8)),
    height: Math.max(8, Math.round(headerH * 0.68))
  }
  const titleRgba = cropSubRgba(
    separatedHeader.hasForeground ? separatedHeader.foregroundRgba : headerRaw,
    width,
    headerH,
    titleRect
  )

  return [
    {
      idSuffix: 'foldout-content',
      name: isZh ? `${baseName} · 展开内容区 (#unity-content)` : `${baseName} · Foldout Content`,
      description: isZh ? 'Foldout 折叠抽屉展开内容面板' : 'Foldout collapsible content container',
      uiControlType: 'foldout',
      uiPartRole: 'foldout-content',
      left: left + contentRect.left,
      top: top + contentRect.top,
      width: contentRect.width,
      height: contentRect.height,
      rgba: cropSubRgba(rgba, width, height, contentRect),
      visible: true,
      ...(nineSliceBorders ? { nineSliceBorders } : {})
    },
    {
      idSuffix: 'foldout-header-bg',
      name: isZh ? `${baseName} · 折叠标题栏底板 (Header BG)` : `${baseName} · Header BG`,
      description: isZh
        ? 'Foldout 顶部点击折叠条净底板'
        : 'Foldout clickable header bar background',
      uiControlType: 'foldout',
      uiPartRole: 'foldout-header-bg',
      left,
      top,
      width,
      height: headerH,
      rgba: separatedHeader.cleanPlateRgba,
      visible: true
    },
    {
      idSuffix: 'foldout-arrow',
      name: isZh
        ? `${baseName} · 展开箭头 (.unity-foldout__checkmark)`
        : `${baseName} · Foldout Arrow`,
      description: isZh ? 'Foldout 展开/收起三角指示图标' : 'Foldout expand/collapse arrow icon',
      uiControlType: 'foldout',
      uiPartRole: 'foldout-arrow',
      left: left + arrowRect.left,
      top: top + arrowRect.top,
      width: arrowRect.width,
      height: arrowRect.height,
      rgba: cropSubRgba(
        separatedHeader.hasForeground ? separatedHeader.foregroundRgba : headerRaw,
        width,
        headerH,
        arrowRect
      ),
      visible: true
    },
    {
      idSuffix: 'foldout-title',
      name: isZh ? `${baseName} · 折叠栏标题文字 (Title)` : `${baseName} · Foldout Title`,
      description: isZh ? 'Foldout 折叠栏标题文字层' : 'Foldout header title text layer',
      uiControlType: 'foldout',
      uiPartRole: 'foldout-title',
      left: left + titleRect.left,
      top: top + titleRect.top,
      width: titleRect.width,
      height: titleRect.height,
      rgba: titleRgba,
      visible: true,
      editableText: estimateEditableTextMeta({
        foregroundRgba: titleRgba,
        width: titleRect.width,
        height: titleRect.height,
        rawName: baseName,
        fallbackText: isZh ? '基础属性' : 'Section',
        align: 'left'
      })
    }
  ]
}

/**
 * RadialProgress 环形进度条 / 冷却轮盘 / 炼丹阵环极坐标拆解：
 * [环形轨道底槽 radial-track-ring, 发光环形进度 radial-fill-ring, 中心阵眼图标/数值 radial-center-icon]
 */
function decomposeRadialProgressParts(input: {
  rgba: Uint8ClampedArray
  left: number
  top: number
  width: number
  height: number
  baseName: string
  isZh: boolean
}): DecomposedControlSubPart[] {
  const { rgba, left, top, width, height, baseName, isZh } = input
  const total = width * height
  const trackRingRgba = new Uint8ClampedArray(total * 4)
  const fillRingRgba = new Uint8ClampedArray(total * 4)
  const centerIconRgba = new Uint8ClampedArray(total * 4)

  const cx = width / 2
  const cy = height / 2
  const maxR = Math.min(cx, cy)

  // 计算外环区平均明度以区分发光填充扇区与暗色轨道槽
  let ringLumaSum = 0
  let ringCount = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rNorm = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / maxR
      if (rNorm >= 0.58 && rNorm <= 0.98) {
        const idx = (y * width + x) * 4
        if (rgba[idx + 3]! >= 32) {
          ringLumaSum += 0.299 * rgba[idx]! + 0.587 * rgba[idx + 1]! + 0.114 * rgba[idx + 2]!
          ringCount++
        }
      }
    }
  }
  const ringMeanLuma = ringCount > 0 ? ringLumaSum / ringCount : 110

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rNorm = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / maxR
      const idx = (y * width + x) * 4
      const r = rgba[idx]!
      const g = rgba[idx + 1]!
      const b = rgba[idx + 2]!
      const a = rgba[idx + 3]!
      if (a < 16) continue

      if (rNorm < 0.58) {
        // 中心阵眼图标/数值文字区
        centerIconRgba[idx] = r
        centerIconRgba[idx + 1] = g
        centerIconRgba[idx + 2] = b
        centerIconRgba[idx + 3] = a
      } else if (rNorm <= 1.02) {
        const luma = 0.299 * r + 0.587 * g + 0.114 * b
        // 环形轨道底槽（暗化还原完整底环）
        trackRingRgba[idx] = Math.round(r * 0.55)
        trackRingRgba[idx + 1] = Math.round(g * 0.55)
        trackRingRgba[idx + 2] = Math.round(b * 0.55)
        trackRingRgba[idx + 3] = a

        // 高亮扇区提取到发光环形进度层 (radial-fill-ring)
        if (luma >= ringMeanLuma * 0.95) {
          fillRingRgba[idx] = r
          fillRingRgba[idx + 1] = g
          fillRingRgba[idx + 2] = b
          fillRingRgba[idx + 3] = a
        }
      }
    }
  }

  return [
    {
      idSuffix: 'radial-track-ring',
      name: isZh ? `${baseName} · 环形轨道底槽 (Track Ring)` : `${baseName} · Radial Track Ring`,
      description: isZh ? '环形进度条完整外圈暗色底槽' : 'Radial progress outer track ring',
      uiControlType: 'radial-progress',
      uiPartRole: 'radial-track-ring',
      left,
      top,
      width,
      height,
      rgba: trackRingRgba,
      visible: true
    },
    {
      idSuffix: 'radial-fill-ring',
      name: isZh ? `${baseName} · 发光环形进度 (Fill Ring)` : `${baseName} · Radial Fill Ring`,
      description: isZh ? '环形进度条高亮激活扇区' : 'Radial progress active glowing arc',
      uiControlType: 'radial-progress',
      uiPartRole: 'radial-fill-ring',
      left,
      top,
      width,
      height,
      rgba: fillRingRgba,
      visible: true
    },
    {
      idSuffix: 'radial-center-icon',
      name: isZh ? `${baseName} · 中心阵眼图标/数值 (Center)` : `${baseName} · Radial Center`,
      description: isZh ? '环形中心图标或冷却秒数文字层' : 'Radial center icon or value text',
      uiControlType: 'radial-progress',
      uiPartRole: 'radial-center-icon',
      left,
      top,
      width,
      height,
      rgba: centerIconRgba,
      visible: true
    }
  ]
}

/**
 * 检测面板右上角候选框是否存在显著的关闭按钮 (×) 局部对比度特征。
 */
function hasCornerCloseButtonContrast(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  rect: { left: number; top: number; width: number; height: number }
): boolean {
  let minL = 255
  let maxL = 0
  let count = 0
  for (let y = rect.top; y < Math.min(height, rect.top + rect.height); y++) {
    for (let x = rect.left; x < Math.min(width, rect.left + rect.width); x++) {
      const idx = (y * width + x) * 4
      if (rgba[idx + 3]! < 48) continue
      const l = 0.299 * rgba[idx]! + 0.587 * rgba[idx + 1]! + 0.114 * rgba[idx + 2]!
      if (l < minL) minL = l
      if (l > maxL) maxL = l
      count++
    }
  }
  return count >= 16 && maxL - minL >= 42
}

/**
 * 对局部小矩形区域执行左/下邻域双线性纹理修补（用于从面板底框上擦除右上角关闭按钮）。
 */
function inpaintLocalRectInPlace(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  rect: { left: number; top: number; width: number; height: number }
): void {
  const sampleLeftX = Math.max(0, rect.left - 2)
  const sampleBottomY = Math.min(height - 1, rect.top + rect.height + 1)
  for (let y = rect.top; y < Math.min(height, rect.top + rect.height); y++) {
    const lIdx = (y * width + sampleLeftX) * 4
    for (let x = rect.left; x < Math.min(width, rect.left + rect.width); x++) {
      const bIdx = (sampleBottomY * width + x) * 4
      const dst = (y * width + x) * 4
      rgba[dst] = Math.round((rgba[lIdx]! + rgba[bIdx]!) * 0.5)
      rgba[dst + 1] = Math.round((rgba[lIdx + 1]! + rgba[bIdx + 1]!) * 0.5)
      rgba[dst + 2] = Math.round((rgba[lIdx + 2]! + rgba[bIdx + 2]!) * 0.5)
    }
  }
}

function hasVisiblePixels(rgba: Uint8ClampedArray): boolean {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i]! >= 32) return true
  }
  return false
}

function detectSliderFillSplitColumn(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): number {
  const y0 = Math.floor(height * 0.25)
  const y1 = Math.max(y0 + 1, Math.ceil(height * 0.75))
  const colScore = new Float32Array(width)
  for (let x = 0; x < width; x++) {
    let sum = 0
    let count = 0
    for (let y = y0; y < y1; y++) {
      const idx = (y * width + x) * 4
      if (rgba[idx + 3]! < 32) continue
      const r = rgba[idx]!
      const g = rgba[idx + 1]!
      const b = rgba[idx + 2]!
      const luma = 0.299 * r + 0.587 * g + 0.114 * b
      const chroma = Math.max(r, g, b) - Math.min(r, g, b)
      sum += luma + chroma * 0.8
      count++
    }
    colScore[x] = count > 0 ? sum / count : 0
  }
  let bestX = Math.round(width * 0.62)
  let maxDrop = 0
  const xStart = Math.max(2, Math.floor(width * 0.15))
  const xEnd = Math.min(width - 3, Math.ceil(width * 0.88))
  for (let x = xStart; x <= xEnd; x++) {
    const drop = colScore[x - 1]! - colScore[x + 1]!
    if (drop > maxDrop) {
      maxDrop = drop
      bestX = x
    }
  }
  return bestX
}

function extractOrSynthesizeSliderThumb(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  thumbLeft: number,
  thumbSize: number
): Uint8ClampedArray {
  const cropped = cropSubRgba(rgba, width, height, {
    left: thumbLeft,
    top: 0,
    width: thumbSize,
    height
  })
  const cx = thumbSize / 2
  const cy = height / 2
  const radius = Math.min(cx, cy) * 0.92
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < thumbSize; x++) {
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      const idx = (y * thumbSize + x) * 4
      if (dist > radius) {
        cropped[idx + 3] = 0
      } else if (dist > radius - 2) {
        // 亮金/亮白金属手柄外环
        cropped[idx] = 250
        cropped[idx + 1] = 240
        cropped[idx + 2] = 195
        cropped[idx + 3] = 255
      } else {
        cropped[idx] = Math.min(255, cropped[idx]! + 36)
        cropped[idx + 1] = Math.min(255, cropped[idx + 1]! + 36)
        cropped[idx + 2] = Math.min(255, cropped[idx + 2]! + 36)
        cropped[idx + 3] = 255
      }
    }
  }
  return cropped
}
