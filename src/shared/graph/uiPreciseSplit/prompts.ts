/**
 * 精准 UI 拆层的提示词（AI 域数据，双语）：
 * - 版面解析：VLM 结合本地 OCR 文本框输出「元素树」（类别 / 层级 / 绘制顺序 / 0-1000 归一化框）
 * - 局部放大复检：对大容器裁图放大后重新检测其内部子元素
 * - 逐级剥层：指令编辑模型移除某一级元素并补全其下方内容
 */

import type { LocalOcrTextBox } from '../uiControlSpec'
import { UI_ELEMENT_KINDS, type PixelRect } from './types'

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
6. "background_repair.mode": set "scene" if the full-canvas background is a complex scene/illustration occluded by UI, "surface" if it is a flat/gradient backdrop, or "none" if no repair is needed.
7. Text & "raster_text_ids": use kind "text" for plain UI typography (labels, numbers, stack counts like "x5" / "+10" / "Lv.20", descriptions) and "art-text" ONLY for large stylized title banners / logos. Never put stack counts (like "x5") into "raster_text_ids". Reference matching OCR ids in "ocr" and correct OCR misreads in "text".
8. Composite Card / Avatar Slot / Item Icon Rule: When a card, avatar frame, or item slot contains a character portrait or item figure, you MUST split it into separate layered elements: (a) the outer slot/card frame & gradient backplate (kind: "item-slot" or "panel", element_repair_mode: "surface"), (b) the character portrait or item illustration inside the slot (kind: "avatar" or "illustration", parent = the slot), (c) any corner badge or puzzle/faction icon (kind: "badge" or "icon", tight box_2d around ONLY the badge), and (d) any stack count / level text (kind: "text", text: "x5"). Never merge the character portrait with the slot frame!
9. Repeated items (e.g. 4 reward slots) must be listed individually, each with its own icon / count text children. Up to 90 elements.`
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
6. background_repair.mode：底层全屏背景若为复杂场景插画填 "scene"，纯色或简单渐变背景填 "surface"，无需修补填 "none"。
7. 文字与 raster_text_ids：普通 UI 字体（标签、数值、说明、右下角数量叠数如 "x5" / "+10" / "Lv.20"）一律用 "text"；仅大型立体标题/Logo 用 "art-text"（切勿把 "x5" 等数量文字放入 raster_text_ids）。在元素的 "ocr" 中引用匹配的 OCR 编号，并在 "text" 中纠正 OCR 识别错误。
8. 头像框 / 道具槽 / 立绘卡牌必拆规则：当画面或槽位中包含「底框/背景板 + 角色人像/物品图标 + 左上角标 + 右下数量文字」时，必须拆成独立的父子多层：（a）底层槽位底框与背景板（kind: "item-slot" 或 "panel"，element_repair_mode: "surface"），（b）框内的角色头像或物品立绘主体（kind: "avatar" 或 "illustration"，parent 指向底框），（c）左上角拼图/属性角标（kind: "badge" 或 "icon"，box_2d 紧贴角标自身，严禁把相邻头发或边框框进去），（d）右下角数量文字（kind: "text"，text: "x5"）。严禁把角色人像与头像底框合并成一个元素！
9. 重复元素（如 4 个奖励格）必须逐个列出，每个都带自己的图标、数量文字子元素。最多 90 个元素。`
}

export function buildLayoutUserPrompt(input: {
  locale?: string
  width: number
  height: number
  ocrHints: string
  userHint?: string
  sourceTitle?: string
  hasCleanedPreview?: boolean
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
