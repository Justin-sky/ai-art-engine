/**
 * 精准 UI 拆层的提示词（AI 域数据，双语）：
 * - 版面解析：VLM 结合本地 OCR 文本框输出「元素树」（类别 / 层级 / 绘制顺序 / 0-1000 归一化框）
 * - 局部放大复检：对大容器裁图放大后重新检测其内部子元素
 * - 逐级剥层：指令编辑模型移除某一级元素并补全其下方内容
 */

import type { LocalOcrTextBox } from '../uiControlSpec'
import { UI_ELEMENT_KINDS, type PixelRect, type UiElementKind } from './types'

function isEnglish(locale?: string): boolean {
  return typeof locale === 'string' && /^en\b/i.test(locale.trim())
}

function toBox2d(rect: PixelRect, width: number, height: number): string {
  const ymin = Math.round((rect.top / height) * 1000)
  const xmin = Math.round((rect.left / width) * 1000)
  const ymax = Math.round(((rect.top + rect.height) / height) * 1000)
  const xmax = Math.round(((rect.left + rect.width) / width) * 1000)
  return `[${ymin},${xmin},${ymax},${xmax}]`
}

/** OCR 文本框清单（T1..Tn，box_2d 与 VLM 输出同一口径） */
export function formatOcrHints(
  ocr: readonly LocalOcrTextBox[],
  width: number,
  height: number,
  limit = 120
): string {
  return ocr
    .slice(0, limit)
    .map((box, i) => `T${i + 1} ${JSON.stringify(box.text)} box_2d=${toBox2d(box, width, height)}`)
    .join('\n')
}

const KIND_LIST = UI_ELEMENT_KINDS.join(' | ')

export function buildLayoutSystemPrompt(locale?: string): string {
  if (isEnglish(locale)) {
    return `You are a senior game UI artist who slices UI mockups into production-ready PSD layers for Unity / Cocos / Unreal.
You may receive either the original UI image alone, or TWO images: [1] Original UI screenshot, [2] Initial OCR-cleaned image (where detected text was erased).
List EVERY visually separable element as it would be sliced by a professional: panels, frames, banners, buttons, close buttons, arrows, tabs, item slots, icons, badges, avatars, character illustrations, progress bars, dividers, decorations, glow effects, and every text block.
Return ONLY one JSON object, no markdown:
{
  "screenKind": "popup | fullscreen | hud | component",
  "raster_text_ids": ["T1"],
  "background_repair": { "mode": "scene | surface | none" },
  "elements": [
    {
      "id": "e1",
      "name": "short semantic name, e.g. Gift Pack Panel / Buy Button / Close Button",
      "kind": "${KIND_LIST}",
      "box_2d": [ymin, xmin, ymax, xmax],
      "positive_points_norm": [[x, y]],
      "negative_points_norm": [[x, y]],
      "parent": "id of the element it sits on, or null when it sits directly on the background",
      "order": 1,
      "element_repair_mode": "image | surface | none",
      "blend_mode": "normal | screen | linear dodge",
      "font_style": "sans | serif | rounded | condensed | monospace | display",
      "ocr": ["T3"],
      "text": "exact visible text for text / art-text elements"
    }
  ]
}
Rules:
1. box_2d is normalized to 0..1000 [ymin, xmin, ymax, xmax] and must TIGHTLY enclose the element's visible pixels, including its own outline, bevel, drop shadow and outer glow, but nothing else.
2. positive_points_norm: 1 to 3 points [x, y] (0..1000) placed inside the solid foreground body of this element (for SAM instance segmentation). negative_points_norm: 0 to 3 points [x, y] (0..1000) inside or near the box that belong to the parent background or an overlapping sibling (not this element).
3. "parent" is the element directly underneath that contains it (a button on a panel -> parent = panel). Text belongs to the element it is printed on.
4. "order" is painter's order among siblings: larger = drawn later (on top).
5. "element_repair_mode": if child elements sit on top of this element, set "surface" when this element has a flat/uniform/simple-gradient surface that can be repaired locally from boundary colors, or "image" when it has complex illustration/texture requiring generative inpainting; set "none" if nothing occludes it.
6. "background_repair.mode": set "scene" if the full-canvas background is a complex scene/illustration occluded by UI, "surface" if it is a flat/gradient backdrop, or "none" if no repair is needed. Never list the full-screen background scene / wallpaper itself in "elements" (it automatically becomes the Base layer).
7. Text, "font_style" & "raster_text_ids": use kind "text" for plain UI typography (labels, numbers, stack counts like "x5" / "+10" / "Lv.20", descriptions) and set optional "font_style" ("sans" | "serif" | "rounded" | "condensed" | "monospace" | "display"); use "art-text" ONLY for large stylized title banners / logos. Never put stack counts (like "x5") into "raster_text_ids". Reference matching OCR ids in "ocr" and correct OCR misreads in "text".
8. Glow & "blend_mode": for kind "effect" (additive light beams, hologram halos, flare particles), set "blend_mode" to "linear dodge" for hot additive beams/sparks or "screen" for soft ambient glow; omit or use "normal" for all regular UI elements.
9. Composite Card / Avatar Slot / Item Icon Rule: When a card, avatar frame, or item slot contains a character portrait or item figure, you MUST split it into separate layered elements: (a) the outer slot/card frame & gradient backplate (kind: "item-slot" or "panel", element_repair_mode: "surface"), (b) the character portrait or item illustration inside the slot (kind: "avatar" or "illustration", parent = the slot), (c) any corner badge or puzzle/faction icon (kind: "badge" or "icon", tight box_2d around ONLY the badge), and (d) any stack count / level text (kind: "text", text: "x5"). Never merge the character portrait with the slot frame!
10. Dense & Repeated Element Recall: Repeated items (reward slots, star rating pips, pagination dots, currency icons, red notification dots, lock icons, corner ornaments, thin dividers) MUST each be listed individually without omission. Up to 200 elements.`
  }
  return `你是资深游戏 UI 美术，负责把 UI 效果图切成可直接进 Unity / Cocos / UE 的 PSD 分层。
你会收到原图（以及可选的第二张「OCR 初步去字图」）。请结合两张图列出画面中**每一个可独立分离的视觉元素**：面板底框、边框、横幅、按钮、关闭按钮、翻页箭头、页签、道具槽、图标、角标徽章、头像、角色立绘、进度条、分割线、装饰花纹、发光特效，以及每一段文字。
只输出一个 JSON 对象，不要 markdown、不要解释：
{
  "screenKind": "popup | fullscreen | hud | component",
  "raster_text_ids": ["T1"],
  "background_repair": { "mode": "scene | surface | none" },
  "elements": [
    {
      "id": "e1",
      "name": "简短语义名，如：礼包主面板 / 购买按钮 / 关闭按钮",
      "kind": "${KIND_LIST}",
      "box_2d": [ymin, xmin, ymax, xmax],
      "positive_points_norm": [[x, y]],
      "negative_points_norm": [[x, y]],
      "parent": "它直接叠放在其上的元素 id；直接放在背景上则为 null",
      "order": 1,
      "element_repair_mode": "image | surface | none",
      "blend_mode": "normal | screen | linear dodge",
      "font_style": "sans | serif | rounded | condensed | monospace | display",
      "ocr": ["T3"],
      "text": "text / art-text 元素上实际可见的文字"
    }
  ]
}
规则：
1. box_2d 为 0~1000 归一化整数 [ymin, xmin, ymax, xmax]，必须**紧贴**该元素的可见像素（包含它自身的描边、倒角、投影、外发光），不要包含其他内容。
2. positive_points_norm：1~3 个落在元素前景主体内部的锚点 [x, y]（0~1000，供 SAM 2.1 实例分割使用）；negative_points_norm：0~3 个框内属于底层背景或相邻竞争元素的负向排除点 [x, y]（0~1000）。
3. parent 指该元素直接压在其上、并包含它的那个元素（面板上的按钮 → parent = 面板）；文字归属于它所印在的元素。
4. order 是同级之间的绘制顺序：数字越大越后画（越靠上）。
5. element_repair_mode：若该元素上方压了子元素，当其底面为纯色/规则渐变/九宫格底板时填 "surface"（本地边缘色彩延续修补），当其为复杂插画/立绘/纹理时填 "image"（生图修补）；无子元素遮挡则填 "none"。
6. background_repair.mode：底层全屏背景若为复杂场景插画填 "scene"，纯色或简单渐变背景填 "surface"，无需修补填 "none"。严禁把整张全屏场景背景/壁纸本身列进 elements（它会自动作为 Base 底图输出）。
7. 文字、font_style 与 raster_text_ids：普通 UI 字体（标签、数值、说明、右下角数量叠数如 "x5" / "+10" / "Lv.20"）一律用 "text"，并标注可选字体风格 "font_style"（"sans" 黑体无衬线 / "serif" 宋体衬线 / "rounded" 圆体 / "condensed" 窄体数字 / "monospace" 等宽 / "display" 粗重标题体）；仅大型立体标题/Logo 用 "art-text"（切勿把 "x5" 等数量文字放入 raster_text_ids）。在元素的 "ocr" 中引用匹配的 OCR 编号，并在 "text" 中纠正 OCR 识别错误。
8. 光效与 blend_mode：对 kind 为 "effect" 的纯增亮光束、粒子耀斑、全息底座光环，高亮过曝型光束填 "linear dodge"，柔和环境辉光填 "screen"；常规不透明/半透明控件一律填 "normal" 或省略。
9. 头像框 / 道具槽 / 立绘卡牌必拆规则：当画面或槽位中包含「底框/背景板 + 角色人像/物品图标 + 左上角标 + 右下数量文字」时，必须拆成独立的父子多层：（a）底层槽位底框与背景板（kind: "item-slot" 或 "panel"，element_repair_mode: "surface"），（b）框内的角色头像或物品立绘主体（kind: "avatar" 或 "illustration"，parent 指向底框），（c）左上角拼图/属性角标（kind: "badge" 或 "icon"，box_2d 紧贴角标自身，严禁把相邻头发或边框框进去），（d）右下角数量文字（kind: "text"，text: "x5"）。严禁把角色人像与头像底框合并成一个元素！
10. 密集小元素零遗漏规则：重复元素（如奖励格、星级小星星、轮播分页圆点、货币小图标、小红点、小锁头、边角装饰花纹、细分割线）必须逐一单独列出，严禁漏检或把一排小图标合并成一个大框。最多 200 个元素。`
}

export function formatComponentCatalogHints(
  components: ReadonlyArray<{
    id: string
    name: string
    kind: string
    canonicalWidth: number
    canonicalHeight: number
    scalePolicy: string
  }>,
  limit = 48
): string {
  return components
    .slice(0, limit)
    .map(
      (c) =>
        `- id=${JSON.stringify(c.id)} kind=${c.kind} size=${c.canonicalWidth}x${c.canonicalHeight} scale=${c.scalePolicy} name=${JSON.stringify(c.name)}`
    )
    .join('\n')
}

export function buildLayoutUserPrompt(input: {
  locale?: string
  width: number
  height: number
  ocrHints: string
  userHint?: string
  sourceTitle?: string
  hasCleanedPreview?: boolean
  componentCatalogHints?: string
}): string {
  const en = isEnglish(input.locale)
  const context = [input.sourceTitle?.trim(), input.userHint?.trim()].filter(Boolean).join(' | ')
  if (en) {
    return [
      `Image size: ${input.width}x${input.height} px.`,
      input.hasCleanedPreview
        ? 'Two images are attached: Image 1 is the original UI screenshot; Image 2 is the initial OCR-cleaned image with plain text removed so you can inspect underlying UI shapes and audit whether any artistic title/logo text (raster_text_ids) was mistakenly removed.'
        : '',
      input.ocrHints
        ? `Local OCR found these text boxes (pixel-accurate positions, text may contain misreads):\n${input.ocrHints}`
        : 'Local OCR found no text; read all text yourself.',
      input.componentCatalogHints
        ? `Shared UI component library available (if an element visually matches one of these clean master components, set optional "component_id" on that element while still splitting any overlaid text or icons into separate child elements):\n${input.componentCatalogHints}`
        : '',
      context ? `Context from the user: ${context}` : '',
      'Output the JSON object now.'
    ]
      .filter(Boolean)
      .join('\n\n')
  }
  return [
    `图片尺寸：${input.width}x${input.height} 像素。`,
    input.hasCleanedPreview
      ? '已附带两张图片：图 1 为原始 UI 截图，图 2 为擦除普通文字后的初步去字图（便于看清文字下方的控件轮廓，并复核是否有艺术字标题/Logo 需要通过 raster_text_ids 恢复为图形图层）。'
      : '',
    input.ocrHints
      ? `本地 OCR 识别到以下文字框（位置像素级准确，文字可能有误识）：\n${input.ocrHints}`
      : '本地 OCR 未识别到文字，请自行读取画面中的所有文字。',
    input.componentCatalogHints
      ? `已挂载共享 UI 组件库（若画面中的按钮、道具槽、页签、角标、底框等与下列母本同款，请在该元素上填写可选字段 "component_id"，同时仍须将其上方的文字或物品图标拆为独立子元素）：\n${input.componentCatalogHints}`
      : '',
    context ? `用户补充说明：${context}` : '',
    '现在输出 JSON 对象。'
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** 局部放大复检：只检测容器内部的子元素 */
export function buildZoomUserPrompt(input: {
  locale?: string
  containerName: string
  width: number
  height: number
  ocrHints: string
}): string {
  if (isEnglish(input.locale)) {
    return [
      `This is a zoomed-in crop (${input.width}x${input.height} px) of the element "${input.containerName}" from a larger UI screen.`,
      'List every element that sits INSIDE / ON TOP OF this container. Do NOT list the container itself; use parent = null for its direct children.',
      'box_2d coordinates are relative to THIS crop (0..1000).',
      input.ocrHints ? `OCR text boxes inside this crop:\n${input.ocrHints}` : '',
      'Output the JSON object now.'
    ]
      .filter(Boolean)
      .join('\n\n')
  }
  return [
    `这是从完整 UI 界面中裁出并放大的「${input.containerName}」区域（${input.width}x${input.height} 像素）。`,
    '请列出所有位于该容器内部、叠放在它上面的元素。不要列出容器本身；容器的直接子元素 parent 填 null。',
    'box_2d 坐标相对于**这张裁图**（0~1000）。',
    input.ocrHints ? `该区域内的 OCR 文字框：\n${input.ocrHints}` : '',
    '现在输出 JSON 对象。'
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** 逐级剥层：让指令编辑模型移除一组元素并补全其下方内容 */
export function buildPeelEditPrompt(input: {
  locale?: string
  width: number
  height: number
  targets: ReadonlyArray<{ name: string; box: PixelRect }>
}): string {
  const en = isEnglish(input.locale)
  const listed = input.targets.slice(0, 30)
  const rest = input.targets.length - listed.length
  const describe = (t: { name: string; box: PixelRect }, i: number): string => {
    const cx = Math.round(((t.box.left + t.box.width / 2) / input.width) * 100)
    const cy = Math.round(((t.box.top + t.box.height / 2) / input.height) * 100)
    const w = Math.round((t.box.width / input.width) * 100)
    const h = Math.round((t.box.height / input.height) * 100)
    return en
      ? `${i + 1}. ${t.name} (center at x ${cx}%, y ${cy}%, size ${w}% x ${h}%)`
      : `${i + 1}. ${t.name}（中心约在 x ${cx}%、y ${cy}%，尺寸约 ${w}% x ${h}%）`
  }
  const lines = listed.map(describe).join('\n')
  if (en) {
    return `This is a game UI image. Remove ONLY the UI elements listed below and realistically reconstruct what lies underneath them (continue the underlying panel texture, gradients, borders, patterns and background exactly). Keep every other pixel, the composition, the canvas size, the colors and the lighting completely unchanged. Do not add any new element, text, watermark or border.
Elements to remove:
${lines}${rest > 0 ? `\n…and ${rest} more small elements of the same kind.` : ''}`
  }
  return `这是一张游戏 UI 图。请**只移除**下面列出的 UI 元素，并真实还原它们下方被遮挡的内容（严格延续下层底板的纹理、渐变、边框、花纹与背景）。其余所有像素、构图、画布尺寸、配色与光影保持完全不变，不要新增任何元素、文字、水印或边框。
需要移除的元素：
${lines}${rest > 0 ? `\n……以及另外 ${rest} 个同类小元素。` : ''}`
}

/**
 * 单图层遮挡补全（v2 · P3）：只把一个元素的局部裁剪图送模型，黑色区域是被上层控件挡住、
 * 需要按该元素自身内容补全的部分；其余像素必须原样保留（回贴时只取黑洞区域）。
 */
export function buildLayerCompletionPrompt(input: {
  locale?: string
  name: string
  kind: string
}): string {
  if (isEnglish(input.locale)) {
    return `This is a cropped game UI layer "${input.name}" (${input.kind}). The solid black regions (white in the mask) are parts of this same element that were hidden behind other UI controls. Fill ONLY those black regions by continuing this element's own content — character body, hair, clothing, illustration, scenery, lighting, line art and colors — so it looks like the complete, unobstructed element. Keep every non-black pixel, the framing and the size exactly unchanged. Do not draw any UI controls, icons, badges, numbers, text, borders or new objects.`
  }
  return `这是游戏 UI 中「${input.name}」（${input.kind}）图层的局部裁剪图。纯黑区域（掩码中的白色区域）是该元素被其他 UI 控件遮挡的部分。请**只补全纯黑区域**：严格延续该元素自身的内容（角色身体、发丝、服饰、插画、场景、光影、线稿与配色），使其看起来是完整、无遮挡的同一元素。所有非黑色像素、构图与尺寸保持完全不变，不要画任何 UI 控件、图标、徽章、数字、文字、边框或新物体。`
}

/**
 * 图集（Atlas）打包遮挡修补提示词（对标知乎方案 2.3.2）：
 * 把多个被子元素挖空（黑洞）的父级元素打包到同一张图集上，一次性修补所有黑洞区域。
 */
export function buildAtlasInpaintPrompt(input?: {
  locale?: string
  cellNames?: readonly string[]
}): string {
  const en = isEnglish(input?.locale)
  const names = input?.cellNames?.length ? ` (${input.cellNames.slice(0, 16).join(', ')})` : ''
  if (en) {
    return `This is a packed texture atlas containing isolated game UI element crops${names}. Inside several elements, solid black cutouts mark regions where overlapping child UI controls were removed. Fill ONLY the solid black cutout holes by smoothly continuing each element's own immediately adjacent surface material, gradient, border, and texture. Keep every non-black pixel, element silhouette, position, and size in the atlas 100% unchanged. Never draw any new text, numbers, icons, badges, or decorative shapes inside the repaired regions.`
  }
  return `这是一张包含多个独立游戏 UI 控件切片的纹理图集（Atlas）${names}。各切片内部的纯黑挖空区域代表上层子控件被剥离后留下的遮挡空洞。请**只填补纯黑空洞区域**，严格延续每个切片自身紧邻边缘的底板材质、渐变、边框与纹理。图集中所有非黑色像素、各切片的外轮廓、位置与尺寸必须保持 100% 不变，严禁在修补区域内新画任何文字、数字、图标、徽章或多余装饰。`
}

/**
 * 底层场景背景（background_repair.mode = 'scene'）修补提示词（对标知乎方案 2.3.1）：
 * 移除全画面前景 UI 后，把留下的黑色空洞自然延续为完整的底层游戏场景背景。
 */
export function buildSceneBackgroundPrompt(input?: { locale?: string }): string {
  if (isEnglish(input?.locale)) {
    return `This is a game UI background diagnostic plate where foreground UI panels, buttons, and text have been removed, leaving black cutout holes. Reconstruct a complete, clean background scene by naturally continuing the surrounding environment, lighting, perspective, and textures into the black holes. Do not modify any visible non-hole background pixels, and do not add any UI controls, frames, icons, or text.`
  }
  return `这是一张已剥离前景 UI 面板、按钮与文字的底层背景诊断图，被剥离的前景区域呈现为黑色空洞。请顺着周围可见背景的环境结构、透视、光影与材质，将黑色空洞自然补全为完整、干净的游戏底层背景。保留所有原有的非空洞背景像素不变，不要添加任何 UI 框体、按钮、图标或文字。`
}

/**
 * 共享 UI 组件库母版盘点系统提示词（参考 bggg-creator-image2psd 语义规划思路）：
 * 只盘点可复用的 UI 皮肤母版族（按钮、关闭按钮、道具槽/卡框、页签、角标底托、进度条框、横幅飘带、装饰外框、中小型弹窗底板），
 * 严禁把文案、角色头像/立绘、独立物品图标、全屏背景混入组件库，并为每族挑出遮挡最少的最干净样本框。
 */
export function buildComponentCatalogSystemPrompt(locale?: string): string {
  if (isEnglish(locale)) {
    return `You are a Principal Game & App UI Prefab Architect building a clean, reusable UI Component Library (Smart Object / 9-Slice Prefab Atlas) from UI mockups.
Inspect the UI image and catalog ONLY reusable UI skin component families:
- Allowed kinds: "button" | "close-button" | "item-slot" | "tab" | "badge" | "progress-bar" | "banner" | "frame" | "panel"
- STRICTLY EXCLUDE: plain text, artistic title logos ("art-text"), character portraits/avatars, character/scene illustrations, unique item icons inside slots (swords, potions, coins, gems without a frame), thin 1px dividers, particle/glow effects, and full-screen or giant modal backgrounds (> 40% of screen area).

Return ONLY one JSON object, no markdown:
{
  "components": [
    {
      "id": "c1",
      "name": "concise English or localized prefab name, e.g. Primary Gold Button / Inventory Slot Frame / Inactive Tab",
      "kind": "button | close-button | item-slot | tab | badge | progress-bar | banner | frame | panel",
      "exemplar_box_2d": [ymin, xmin, ymax, xmax],
      "instance_boxes_2d": [[ymin, xmin, ymax, xmax]],
      "has_embedded_content": true,
      "embedded_content_desc": "what sits on top of or inside this exemplar that must be stripped for an empty master (e.g. 'white label BUY and gem icon', or '' if already empty)",
      "skin_desc": "precise visual description of the empty UI skin itself (shape, corner style, border bevel, inner fill color/gradient)"
    }
  ]
}
Rules:
1. Group all visually identical skins (same border color, corner style, and fill palette, even if they contain different text labels or different item icons inside!) into ONE component entry, listing all their tight [ymin, xmin, ymax, xmax] (0..1000) boxes in "instance_boxes_2d". Separate active vs inactive states (e.g. selected gold tab vs unselected dark tab) into separate component entries.
2. Choose "exemplar_box_2d" as the SINGLE CLEANEST, LEAST-OCCLUDED instance of that family (e.g. prefer an empty slot over an occupied slot, or a button with short centered text and zero overlapping character hair/badges).
3. Every box_2d must tightly hug ONLY the component's own outer border/bevel (0..1000 integers), excluding external background clutter.
4. Exhaustively catalog EVERY distinct reusable UI control skin on this screen — including all button color/size styles, active & inactive tabs, all slot/card rarity frames, close/back/icon-buttons, top resource/currency pills, badges, progress/slider bars, header banners, and compact sub-panels (<= 40% screen area). Do NOT omit controls that appear only once on this screen. Order from atomic controls to compact frames/cards, up to 28 component families.`
  }
  return `你是资深游戏与应用 UI 组件化架构师，负责从 UI 界面图中盘点并提取「可复用 UI 共享组件母版库」（供 PSD 智能对象与引擎九宫格预制体复用）。
请审视画面，**全面盘点画面中所有可复用的 UI 控件皮肤母版族（切勿遗漏单次出现的独立通用控件）**：
- 允许的 kind："button" | "close-button" | "item-slot" | "tab" | "badge" | "progress-bar" | "banner" | "frame" | "panel"
- **严禁收录**：普通文字、艺术字大标题/Logo、角色头像（avatar）、角色立绘与插画、槽位内独立的武器/药水/金币/宝石等具体物品图标、细分割线、光效粒子，以及全屏底图或占画面 > 40% 的巨型背景大底板。

只输出一个 JSON 对象，不要 markdown、不要解释：
{
  "components": [
    {
      "id": "c1",
      "name": "精炼组件母版名，如：主操作金边按钮 / 道具品质底槽 / 未选中页签 / 关闭按钮",
      "kind": "button | close-button | item-slot | tab | badge | progress-bar | banner | frame | panel",
      "exemplar_box_2d": [ymin, xmin, ymax, xmax],
      "instance_boxes_2d": [[ymin, xmin, ymax, xmax]],
      "has_embedded_content": true,
      "embedded_content_desc": "该样本框内部或上方压着、制作空白母版时必须剥离的内容（如：白色“购买”文字与钻石小图标；若本身已是空槽则填 \"\"）",
      "skin_desc": "剥离文字与内容物后，该纯净空白控件皮肤自身的外观描述（外轮廓圆角/切角、描边金属倒角、内腔底色或渐变材质）"
    }
  ]
}
规则：
1. 凡是底框皮肤外观完全相同（边框配色、圆角造型、内腔底色材质完全一致，仅内部按钮文案或槽内道具图标不同）的多个实例，才归并到同一个组件条目下，在 instance_boxes_2d 中逐一列出它们紧贴外沿的 [ymin, xmin, ymax, xmax]（0~1000 归一化整数）。凡是底色、状态或造型不同的控件（如选中亮色页签 vs 未选中暗色页签、橙色主按钮 vs 蓝色次按钮、不同品质色道具框、顶部货币胶囊条、返回/关闭按钮等），必须各自拆分为独立组件条目，严禁漏报或混并！
2. exemplar_box_2d 必须从同族实例中挑选**遮挡最少、最干净**的那一个（例如：有空道具槽时优先选空槽；按钮优先选无外部立绘头发/红点跨界遮挡、文案简短居中的那一个）。
3. 每个 box_2d 必须紧贴该控件自身的外边框边缘（0~1000 整数），切勿把周围底板杂物框进来。
4. 全面扫描整张界面的顶栏、侧栏、主内容区、底栏与弹窗区，完整列出本图所有可复用控件皮肤（含仅出现 1 次的按钮、关闭/返回按钮、货币底条、进度条框、角标底托、横幅与紧凑小底板），按复用价值从高到低排序，最多输出 28 类组件族。`
}

export function buildComponentCatalogUserPrompt(input: {
  locale?: string
  width: number
  height: number
  extractMode: 'auto' | 'repeated' | 'all-controls'
  userHint?: string
  sourceTitle?: string
}): string {
  const en = isEnglish(input.locale)
  const context = [input.sourceTitle?.trim(), input.userHint?.trim()].filter(Boolean).join(' | ')
  if (en) {
    const modeNote =
      input.extractMode === 'repeated'
        ? 'Extraction mode: REPEATED ONLY — prioritize component skins that appear >= 2 times on this screen (still include clear multi-screen candidate buttons/slots).'
        : 'Extraction mode: ALL REUSABLE CONTROLS — include both repeated component families and standalone reusable UI controls (buttons, close buttons, tabs, slots, badges, progress bars, banners).'
    return [
      `Screen size: ${input.width}x${input.height} px.`,
      modeNote,
      context ? `User hint: ${context}` : '',
      'Output the JSON catalog now.'
    ]
      .filter(Boolean)
      .join('\n\n')
  }
  const modeNote =
    input.extractMode === 'repeated'
      ? '提取范围：仅重复组件优先 —— 重点盘点画面中重复出现 ≥ 2 次的同款控件皮肤（同时保留典型的通用按钮/槽位候选以便跨界面归并）。'
      : '提取范围：全部通用控件 —— 同时盘点重复出现的组件族与单次出现的标准可复用控件（按钮、关闭按钮、页签、道具槽、角标底托、进度条框、横幅）。'
  return [
    `界面尺寸：${input.width}x${input.height} 像素。`,
    modeNote,
    context ? `用户补充说明：${context}` : '',
    '现在输出 JSON 对象。'
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * 纯色底独立组件母版提纯重绘提示词（吸收 bggg-creator-image2psd 的 companion imagegen 方法）：
 * 将裁剪出的单个 UI 控件样本重绘为置于 100% 纯色平涂背景（#FFFFFF 或 #141820）中央的高清空白组件母版，
 * 彻底剥离内部文字/图标/角标与外部投影背景污染，供后续 flood-fill 结构保护反预乘抠出完美透明边缘。
 */
export function buildComponentPurifyPrompt(input: {
  locale?: string
  name: string
  kind: string
  skinDesc?: string
  embeddedContentDesc?: string
  bgHex: '#FFFFFF' | '#141820'
  userHint?: string
}): string {
  const en = isEnglish(input.locale)
  const isCloseOrGlyphBtn = input.kind === 'close-button'
  const bgDescEn =
    input.bgHex === '#FFFFFF'
      ? 'pure flat solid white (#FFFFFF, RGB 255,255,255)'
      : 'pure flat solid dark slate (#141820, RGB 20,24,32)'
  const bgDescZh =
    input.bgHex === '#FFFFFF'
      ? '100% 纯平涂纯白背景（#FFFFFF，RGB 255,255,255）'
      : '100% 纯平涂深灰黑背景（#141820，RGB 20,24,32）'

  if (en) {
    return [
      `Reconstruct this cropped UI control "${input.name}" (${input.kind}) into a crisp, studio-clean, standalone reusable UI component master asset.`,
      `1. BACKGROUND: Place the single UI component centered on a ${bgDescEn} background with ~10% clean uniform margin on all four sides. Zero background gradients, zero checkerboard, zero external drop shadows or outer glow bleeding onto the background.`,
      isCloseOrGlyphBtn
        ? `2. CLEAN CLOSE BUTTON MASTER: Keep the close button's own built-in 'X' / cross icon crisp and centered if it is a close button, but remove any surrounding background fragments, overlapping hair/ornaments, or red notification dots.`
        : `2. EMPTY REUSABLE SKIN (100% DE-TEXTED & DE-ICONED): Completely remove ALL overlaid text, numbers, labels, item icons, character portraits, and notification dots${input.embeddedContentDesc ? ` (specifically remove: ${input.embeddedContentDesc})` : ''}. Smoothly reconstruct and continue the control's own empty inner surface, gradient, bevel, and recessed backplate.`,
      `3. STRICT 1:1 GEOMETRY & STYLE: Preserve the exact aspect ratio, outer silhouette, corner radius/chamfer, corner ornaments, border thickness, bevel highlights, and color palette${input.skinDesc ? ` (${input.skinDesc})` : ''}. Orthographic flat 2D front view, razor-sharp anti-aliased edges.`,
      input.userHint ? `4. Additional note: ${input.userHint}` : ''
    ]
      .filter(Boolean)
      .join('\n')
  }

  return [
    `请将这张裁剪出的 UI 控件样本「${input.name}」（类型：${input.kind}）提纯重绘为一张**高清、边缘锋利、可直接复用的独立 UI 组件空白母版素材**。`,
    `1. 纯净纯色背景：将单个控件居中放置在 ${bgDescZh} 上，四周留出约 10% 的均匀纯色边距。严禁画棋盘格、严禁背景渐变、严禁外部投影或外发光污染纯色背景，确保控件外边缘与纯色底干净分离。`,
    isCloseOrGlyphBtn
      ? `2. 关闭按钮提纯：保留关闭按钮自身固有的居中“×”叉号造型与金属/立体高光，彻底清除周围粘连的底板背景残片、红点角标或跨界遮挡物。`
      : `2. 彻底清空内部文案与内容物：100% 移除控件上方或槽位内部的所有文字、数字、标签、道具图标、角色头像、红点角标与外部遮挡残片${input.embeddedContentDesc ? `（特别需清除：${input.embeddedContentDesc}）` : ''}，平滑延续该控件原本的空白内腔底面、渐变光泽、内凹槽底板与倒角纹理。`,
    `3. 严格保持 1:1 造型与美术风格：严格保持原控件的长宽比例、外轮廓圆角/切角、四角装饰纹样、描边粗细、高光倒角与色彩质感完全一致${input.skinDesc ? `（皮肤特征：${input.skinDesc}）` : ''}。正交 2D 平视视角，线条笔直对称、边缘清晰锐利。`,
    input.userHint ? `4. 补充要求：${input.userHint}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

export function inferComponentKindFromLabel(rawName: string): UiElementKind {
  const lower = rawName.toLowerCase()
  if (lower.includes('close') || rawName.includes('关闭')) return 'close-button'
  if (lower.includes('slot') || lower.includes('grid') || rawName.includes('槽')) return 'item-slot'
  if (lower.includes('tab') || rawName.includes('页签') || rawName.includes('标签页')) return 'tab'
  if (lower.includes('btn') || lower.includes('button') || rawName.includes('按钮')) return 'button'
  if (lower.includes('badge') || rawName.includes('角标')) return 'badge'
  if (lower.includes('banner') || rawName.includes('横幅')) return 'banner'
  if (lower.includes('bar') || rawName.includes('进度')) return 'progress-bar'
  if (lower.includes('frame') || rawName.includes('框')) return 'frame'
  return 'other'
}

/**
 * 遮挡图层纯色棚拍伴生补全提示词（吸收 bggg-creator-image2psd 的 companion imagegen 方法）：
 * 当局部挖黑洞修补因重绘漂移或接缝色差失败时，将该前景主体（角色立绘/头像/图标/艺术字等）
 * 独立补全到 100% 纯色摄影棚底（#FFFFFF 或 #141820）上，再经 white-preserve 抠图与可见像素锁定回贴遮挡区。
 */
export function buildCompanionLayerPurifyPrompt(input: {
  locale?: string
  name: string
  kind: string
  bgHex: '#FFFFFF' | '#141820'
}): string {
  const en = isEnglish(input.locale)
  const bgDescEn =
    input.bgHex === '#FFFFFF'
      ? 'pure flat solid white (#FFFFFF, RGB 255,255,255)'
      : 'pure flat solid dark slate (#141820, RGB 20,24,32)'
  const bgDescZh =
    input.bgHex === '#FFFFFF'
      ? '100% 纯平涂纯白背景（#FFFFFF，RGB 255,255,255）'
      : '100% 纯平涂深灰黑背景（#141820，RGB 20,24,32）'

  if (en) {
    return [
      `Reconstruct this cropped foreground UI element "${input.name}" (${input.kind}) as a complete, unobstructed standalone layer asset.`,
      `1. SOLID STUDIO BACKGROUND: Render ONLY this single subject on a ${bgDescEn} background with ~8% clean uniform margin. Do not draw checkerboard patterns, background scenery, or external UI frames.`,
      `2. COMPLETE OCCLUDED PARTS: Naturally restore any parts that were cut off, blacked out, or occluded by overlapping badges, buttons, or text (continuing the exact character hair, outfit, emblem silhouette, line art, lighting, and colors).`,
      `3. PIXEL-CONSISTENT FRAMING: Keep the exact camera angle, pose, proportions, and color palette of the visible regions so it aligns 1:1 when composited back.`
    ].join('\n')
  }

  return [
    `请将这张裁剪出的前景 UI 元素「${input.name}」（类型：${input.kind}）独立补全并提纯为一张**完整无遮挡的单层素材图**。`,
    `1. 纯净纯色棚拍底：只保留该单一主体，将其完整绘制在 ${bgDescZh} 上（四周留出约 8% 均匀纯色边距），严禁画棋盘格、背景杂景或外围无关 UI 框。`,
    `2. 完整还原被遮挡部位：将原图中被角标、按钮、文字压住或涂黑缺失的部位自然补全（严格延续该角色发丝、服饰、图标纹样或艺术字自身的轮廓、线稿、光影与配色）。`,
    `3. 严守原构图比例：可见部位的姿态、透视、比例与色彩必须与原图保持 1:1 一致，以便回贴对齐。`
  ].join('\n')
}

/**
 * 独立图形元素（图标 / 艺术字标题 / 角色头像立绘 / 装饰纹样）纯色摄影棚伴生抠图与遮挡提纯提示词：
 * 保持主体自身笔触、字形、细节与色彩 1:1 不变，彻底剥离外围底板杂景与跨界遮挡物，以获得零毛边高精度 Alpha 轮廓。
 */
export function buildStandaloneLayerPurifyPrompt(input: {
  locale?: string
  name: string
  kind: string
  bgHex: '#FFFFFF' | '#141820'
  occluderDesc?: string
  artTextValue?: string
}): string {
  const en = isEnglish(input.locale)
  const bgDescEn =
    input.bgHex === '#FFFFFF'
      ? 'pure flat solid white (#FFFFFF, RGB 255,255,255)'
      : 'pure flat solid dark slate (#141820, RGB 20,24,32)'
  const bgDescZh =
    input.bgHex === '#FFFFFF'
      ? '100% 纯平涂纯白背景（#FFFFFF，RGB 255,255,255）'
      : '100% 纯平涂深灰黑背景（#141820，RGB 20,24,32）'

  if (en) {
    return [
      `Extract and purify ONLY the standalone UI graphical element "${input.name}" (kind: ${input.kind}) from the reference crop onto a flat studio background.`,
      `1. SOLID STUDIO BACKGROUND: Place ONLY this isolated element centered on a ${bgDescEn} background with ~6% clean margin. Remove 100% of surrounding slot frames, panel backgrounds, textures, and checkerboard patterns.`,
      input.occluderDesc
        ? `2. STRIP EXTERNAL OCCLUDERS & RESTORE SILHOUETTE: Completely remove overlapping external UI items (${input.occluderDesc}) and cleanly complete the occluded portion of "${input.name}".`
        : `2. CLEAN SILHOUETTE: Preserve the element's own outer stroke, bevel, and crisp contour while removing any external background residue trapped in concave gaps.`,
      input.artTextValue
        ? `3. EXACT GLYPHS: Preserve the exact stylized characters "${input.artTextValue}", stroke shapes, 3D bevel, and colors 1:1 without changing a single stroke.`
        : `3. STRICT 1:1 FIDELITY: Preserve the exact silhouette, proportions, internal details, lighting, and colors 1:1 with zero pose or style drift.`
    ].join('\n')
  }

  return [
    `请从参考裁剪图中单独提取并提纯 UI 独立图形元素「${input.name}」（类型：${input.kind}），输出置于纯色摄影棚背景中央的高精度单层素材图。`,
    `1. 纯净纯色背景：将且仅将该独立元素完整置于 ${bgDescZh} 中央（四周留约 6% 均匀纯色边距），100% 彻底剥离周围的槽位底框、面板底纹、场景杂色，严禁画棋盘格或地面投影。`,
    input.occluderDesc
      ? `2. 剥离外部跨界遮挡并补全轮廓：彻底清除压在该元素上方的外部无关遮挡物（${input.occluderDesc}），并自然延续补全被遮挡处的自身轮廓与材质细节。`
      : `2. 锐利无毛边轮廓：完整保留该元素自身的描边、倒角与精细剪影，彻底清除字缝、发丝或凹角内残留的外部底板颜色。`,
    input.artTextValue
      ? `3. 字形零篡改：严格保持艺术字内容「${input.artTextValue}」的每一笔字形结构、立体描边与渐变色彩 1:1 完全一致，绝不增删或改写笔画。`
      : `3. 严格 1:1 保真：主体的比例、轮廓、五官/图标细节、光影与配色必须与原图保持 1:1 完全一致，严禁移位或变形。`
  ].join('\n')
}
