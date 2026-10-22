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
Given a UI image, list EVERY visually separable element as it would be sliced by a professional: panels, frames, banners, buttons, close buttons, arrows, tabs, item slots, icons, badges, avatars, character illustrations, progress bars, dividers, decorations, glow effects, and every text block.
Return ONLY one JSON object, no markdown:
{
  "screenKind": "popup | fullscreen | hud | component",
  "elements": [
    {
      "id": "e1",
      "name": "short semantic name, e.g. Gift Pack Panel / Buy Button / Close Button",
      "kind": "${KIND_LIST}",
      "box_2d": [ymin, xmin, ymax, xmax],
      "parent": "id of the element it sits on, or null when it sits directly on the background",
      "order": 1,
      "ocr": ["T3"],
      "text": "exact visible text for text / art-text elements"
    }
  ]
}
Rules:
1. box_2d is normalized to 0..1000 and must TIGHTLY enclose the element's visible pixels, including its own outline, bevel, drop shadow and outer glow, but nothing else.
2. "parent" is the element directly underneath that contains it (a button on a panel -> parent = panel). Text belongs to the element it is printed on.
3. "order" is painter's order among siblings: larger = drawn later (on top).
4. Do NOT list the full-canvas background itself. Do list a translucent dimming overlay as kind "effect" if present.
5. Text: one element per text block / label. Use kind "text" for plain UI typography (labels, numbers, descriptions) and "art-text" for stylized title art (gradients, thick outlines, 3D, decorative glyphs). Reference matching OCR ids in "ocr" and correct OCR misreads in "text".
6. Repeated items (e.g. 4 reward slots) must be listed individually, each with its own icon / count text children.
7. Be exhaustive and precise: small icons, badges, page dots and decorative ornaments matter. Up to 90 elements.`
  }
  return `你是资深游戏 UI 美术，负责把 UI 效果图切成可直接进 Unity / Cocos / UE 的 PSD 分层。
请像专业美工切图一样，列出画面中**每一个可独立分离的视觉元素**：面板底框、边框、横幅、按钮、关闭按钮、翻页箭头、页签、道具槽、图标、角标徽章、头像、角色立绘、进度条、分割线、装饰花纹、发光特效，以及每一段文字。
只输出一个 JSON 对象，不要 markdown、不要解释：
{
  "screenKind": "popup | fullscreen | hud | component",
  "elements": [
    {
      "id": "e1",
      "name": "简短语义名，如：礼包主面板 / 购买按钮 / 关闭按钮",
      "kind": "${KIND_LIST}",
      "box_2d": [ymin, xmin, ymax, xmax],
      "parent": "它直接叠放在其上的元素 id；直接放在背景上则为 null",
      "order": 1,
      "ocr": ["T3"],
      "text": "text / art-text 元素上实际可见的文字"
    }
  ]
}
规则：
1. box_2d 为 0~1000 归一化整数，必须**紧贴**该元素的可见像素（包含它自身的描边、倒角、投影、外发光），不要包含其他内容。
2. parent 指该元素直接压在其上、并包含它的那个元素（面板上的按钮 → parent = 面板）；文字归属于它所印在的元素。
3. order 是同级之间的绘制顺序：数字越大越后画（越靠上）。
4. 不要列出整张画布的背景本身；若有半透明压暗遮罩，用 kind "effect" 列出。
5. 文字：每个文字块/标签单独一个元素。普通 UI 字体（标签、数值、说明）用 "text"；带渐变、粗描边、立体、装饰字形的标题艺术字用 "art-text"。在 "ocr" 中引用匹配的 OCR 编号，并在 "text" 中纠正 OCR 识别错误。
6. 重复元素（如 4 个奖励格）必须逐个列出，每个都带自己的图标、数量文字子元素。
7. 务必完整、精确：小图标、角标、分页圆点、装饰角花都要列出。最多 90 个元素。`
}

export function buildLayoutUserPrompt(input: {
  locale?: string
  width: number
  height: number
  ocrHints: string
  userHint?: string
  sourceTitle?: string
}): string {
  const en = isEnglish(input.locale)
  const context = [input.sourceTitle?.trim(), input.userHint?.trim()].filter(Boolean).join(' | ')
  if (en) {
    return [
      `Image size: ${input.width}x${input.height} px.`,
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
