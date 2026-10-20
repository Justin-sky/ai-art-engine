/**
 * 漫剧/条漫「智能对白气泡避让与情绪气泡自动排版」引擎
 * （Smart Manga/Webtoon Balloon Layout & Emotion-Driven SVG Typesetter）
 *
 * 1. 自动识别台词情绪语义：普通对白（`normal`）、爆炸怒吼（`shout`）、虚线低语（`whisper`）、云朵独白（`thought`）、方框旁白（`narration`）
 * 2. 结合视觉显著性场（`computeVisualSaliencyMap`）与人脸禁区框（`avoidZones`），在背景留白处自动寻址零遮挡气泡坐标
 * 3. 支持国漫/条漫从左到右（`ltr`）与日漫从右到左（`rtl`）阅读流自动排序，并自动计算指向说话人头部的气泡尖角向量（`tailTip`）
 * 4. 一键渲染高分辨率可缩放矢量 SVG 对白气泡叠加层（`renderSmartBalloonsToSvgOverlay`）
 */

import { computeVisualSaliencyMap, type NormalizedRect } from './compositionSaliencyAuditor'

export type BalloonEmotionStyle = 'normal' | 'shout' | 'whisper' | 'thought' | 'narration'

export interface DialogueLineInput {
  id: string
  speaker?: string
  text: string
  emotion?: BalloonEmotionStyle
  /** 说话人头部/嘴部归一化坐标 (0..1)，若未指定则自动指向画面主焦点 */
  speakerAnchor?: { x: number; y: number }
}

export interface PlacedDialogueBalloon {
  id: string
  speaker?: string
  text: string
  emotion: BalloonEmotionStyle
  /** 气泡外框归一化矩形 (0..1) */
  box: NormalizedRect
  /** 气泡尖角指向的目标点 (0..1)；旁白框无尖角则为 null */
  tailTip: { x: number; y: number } | null
  /** 该位置的背景显著性遮挡代价 0..1（越低代表越不挡主体） */
  occlusionCost: number
}

export interface SmartBalloonLayoutPlan {
  readingOrder: 'ltr' | 'rtl'
  canvasWidth: number
  canvasHeight: number
  balloons: PlacedDialogueBalloon[]
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

/**
 * 从台词文本标点与情绪词自动推断漫剧气泡几何样式
 */
export function inferBalloonEmotionFromText(text: string): BalloonEmotionStyle {
  const t = text.trim()
  if (!t) return 'normal'
  if (/^【.*】$|^\[.*\]$|^旁白[:：]/i.test(t)) {
    return 'narration'
  }
  if (/^[（(].*[）)]$|内心[:：]|心想[:：]/i.test(t)) {
    return 'thought'
  }
  if (/！{2,}|!{2,}|[！!][？?]|[？?][！!]|混蛋|住手|去死|啊{2,}|受死/i.test(t)) {
    return 'shout'
  }
  if (/^(?:……|\.{3,})|(?:小声|低语|耳语|喃喃)/i.test(t)) {
    return 'whisper'
  }
  return 'normal'
}

function rectIntersectionArea(a: NormalizedRect, b: NormalizedRect): number {
  const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return xOverlap * yOverlap
}

/**
 * 计算画面显著性避让与阅读流约束下的最优漫剧气泡布局方案
 */
export function planSmartBalloonLayout(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  dialogues: ReadonlyArray<DialogueLineInput>,
  options?: {
    /** 阅读顺序：'ltr'（条漫/美漫左起）| 'rtl'（日漫右起），默认 'ltr' */
    readingOrder?: 'ltr' | 'rtl'
    /** 严禁遮挡的人脸/核心禁区归一化矩形列表 */
    avoidZones?: ReadonlyArray<NormalizedRect>
  }
): SmartBalloonLayoutPlan {
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  const readingOrder = options?.readingOrder ?? 'ltr'
  const avoidZones = options?.avoidZones ?? []

  if (dialogues.length === 0) {
    return { readingOrder, canvasWidth: w, canvasHeight: h, balloons: [] }
  }

  const saliency = computeVisualSaliencyMap(pixels, w, h)

  // 寻找全图显著性最高的主角色锚点（作为默认气泡尖角指向点）
  let peakSal = -1
  let defaultSpeakerX = 0.5
  let defaultSpeakerY = 0.45
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = saliency[y * w + x] ?? 0
      if (s > peakSal) {
        peakSal = s
        defaultSpeakerX = (x + 0.5) / w
        defaultSpeakerY = (y + 0.5) / h
      }
    }
  }

  const placed: PlacedDialogueBalloon[] = []
  const total = dialogues.length

  for (let idx = 0; idx < total; idx++) {
    const line = dialogues[idx]!
    const emotion = line.emotion ?? inferBalloonEmotionFromText(line.text)
    const charLen = Math.max(2, line.text.trim().length)

    // 根据字数估算归一化气泡宽高
    const boxW = clamp(0.22 + Math.min(charLen, 28) * 0.006, 0.22, 0.44)
    const boxH = clamp(0.11 + Math.ceil(charLen / 12) * 0.045, 0.12, 0.28)

    // 根据阅读顺序（ltr 从左上到右下，rtl 从右上到左下）生成期望锚点区域
    const progress = total <= 1 ? 0 : idx / (total - 1)
    const preferredX =
      readingOrder === 'rtl'
        ? clamp(0.78 - progress * 0.56 - boxW * 0.5, 0.04, 0.96 - boxW)
        : clamp(0.18 + progress * 0.56 - boxW * 0.5, 0.04, 0.96 - boxW)
    const preferredY = clamp(0.06 + progress * 0.58, 0.04, 0.92 - boxH)

    // 在全画幅网格搜索遮挡显著性最低、不压人脸禁区、不与已放置气泡重叠的最佳位置
    let bestRect: NormalizedRect = { x: preferredX, y: preferredY, width: boxW, height: boxH }
    let bestTotalCost = Infinity
    let bestSalCost = 0.5

    const gridCols = 6
    const gridRows = 6
    for (let gy = 0; gy < gridRows; gy++) {
      const candY = 0.04 + (gy / (gridRows - 1)) * (0.92 - boxH)
      for (let gx = 0; gx < gridCols; gx++) {
        const candX = 0.04 + (gx / (gridCols - 1)) * (0.92 - boxW)
        const candRect: NormalizedRect = { x: candX, y: candY, width: boxW, height: boxH }

        // 1. 采样该候选框内的平均视觉显著性（越高说明越挡主体）
        const x0 = clamp(Math.floor(candX * w), 0, w - 1)
        const x1 = clamp(Math.ceil((candX + boxW) * w), x0 + 1, w)
        const y0 = clamp(Math.floor(candY * h), 0, h - 1)
        const y1 = clamp(Math.ceil((candY + boxH) * h), y0 + 1, h)
        let sSum = 0
        let sCnt = 0
        for (let py = y0; py < y1; py += Math.max(1, Math.floor((y1 - y0) / 6))) {
          for (let px = x0; px < x1; px += Math.max(1, Math.floor((x1 - x0) / 6))) {
            sSum += saliency[py * w + px] ?? 0
            sCnt++
          }
        }
        const meanSal = sCnt > 0 ? sSum / sCnt : 0.5

        // 2. 与人脸/禁区的重叠惩罚
        let avoidPenalty = 0
        for (const az of avoidZones) {
          const area = rectIntersectionArea(candRect, az)
          if (area > 0) {
            avoidPenalty += (area / (boxW * boxH)) * 8.0
          }
        }

        // 3. 与已排布气泡的重叠惩罚
        let overlapPenalty = 0
        for (const prev of placed) {
          const area = rectIntersectionArea(candRect, prev.box)
          if (area > 0) {
            overlapPenalty += (area / (boxW * boxH)) * 12.0
          }
        }

        // 4. 阅读流顺序偏离惩罚
        const flowDist = Math.hypot((candX - preferredX) * 0.85, (candY - preferredY) * 1.1)
        const totalCost = meanSal * 1.6 + avoidPenalty + overlapPenalty + flowDist * 0.75

        if (totalCost < bestTotalCost) {
          bestTotalCost = totalCost
          bestRect = candRect
          bestSalCost = meanSal
        }
      }
    }

    const speakerPt = line.speakerAnchor ?? { x: defaultSpeakerX, y: defaultSpeakerY }
    const cx = bestRect.x + bestRect.width * 0.5
    const cy = bestRect.y + bestRect.height * 0.5
    const dx = speakerPt.x - cx
    const dy = speakerPt.y - cy
    const dist = Math.hypot(dx, dy) || 1
    const tailLen = Math.min(0.09, dist * 0.45)

    const tailTip =
      emotion === 'narration'
        ? null
        : {
            x: Number(
              clamp(cx + (dx / dist) * (bestRect.width * 0.48 + tailLen), 0.02, 0.98).toFixed(4)
            ),
            y: Number(
              clamp(cy + (dy / dist) * (bestRect.height * 0.48 + tailLen), 0.02, 0.98).toFixed(4)
            )
          }

    placed.push({
      id: line.id,
      speaker: line.speaker,
      text: line.text.trim(),
      emotion,
      box: {
        x: Number(bestRect.x.toFixed(4)),
        y: Number(bestRect.y.toFixed(4)),
        width: Number(bestRect.width.toFixed(4)),
        height: Number(bestRect.height.toFixed(4))
      },
      tailTip,
      occlusionCost: Number(bestSalCost.toFixed(4))
    })
  }

  return {
    readingOrder,
    canvasWidth: w,
    canvasHeight: h,
    balloons: placed
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 将 `SmartBalloonLayoutPlan` 渲染为可独立叠加或导出的矢量 SVG 字符串
 */
export function renderSmartBalloonsToSvgOverlay(plan: SmartBalloonLayoutPlan): string {
  const w = plan.canvasWidth
  const h = plan.canvasHeight
  const elements: string[] = []

  for (const b of plan.balloons) {
    const bx = b.box.x * w
    const by = b.box.y * h
    const bw = b.box.width * w
    const bh = b.box.height * h
    const cx = bx + bw * 0.5
    const cy = by + bh * 0.5

    // 渲染气泡尖角（Tail）
    if (b.tailTip && b.emotion !== 'narration') {
      const tx = b.tailTip.x * w
      const ty = b.tailTip.y * h
      if (b.emotion === 'thought') {
        // 内心独白采用递减圆泡链
        const midX = cx + (tx - cx) * 0.65
        const midY = cy + (ty - cy) * 0.65
        elements.push(
          `<circle cx="${midX.toFixed(1)}" cy="${midY.toFixed(1)}" r="6" fill="#ffffff" stroke="#18181b" stroke-width="2" />`,
          `<circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="3.5" fill="#ffffff" stroke="#18181b" stroke-width="1.8" />`
        )
      } else {
        const perpX = -(ty - cy)
        const perpY = tx - cx
        const pLen = Math.hypot(perpX, perpY) || 1
        const baseHalf = Math.min(12, Math.min(bw, bh) * 0.14)
        const p1x = cx + (perpX / pLen) * baseHalf
        const p1y = cy + (perpY / pLen) * baseHalf
        const p2x = cx - (perpX / pLen) * baseHalf
        const p2y = cy - (perpY / pLen) * baseHalf
        elements.push(
          `<polygon points="${p1x.toFixed(1)},${p1y.toFixed(1)} ${tx.toFixed(1)},${ty.toFixed(1)} ${p2x.toFixed(1)},${p2y.toFixed(1)}" fill="#ffffff" stroke="#18181b" stroke-width="2.2" stroke-linejoin="round" />`
        )
      }
    }

    // 渲染情绪气泡主体轮廓
    if (b.emotion === 'shout') {
      // 爆炸锯齿多边形（怒吼/震惊）
      const spikes = 18
      const pts: string[] = []
      for (let i = 0; i < spikes * 2; i++) {
        const angle = (i * Math.PI) / spikes
        const rScale = i % 2 === 0 ? 1.06 : 0.84
        const px = cx + Math.cos(angle) * (bw * 0.5) * rScale
        const py = cy + Math.sin(angle) * (bh * 0.5) * rScale
        pts.push(`${px.toFixed(1)},${py.toFixed(1)}`)
      }
      elements.push(
        `<polygon points="${pts.join(' ')}" fill="#fffbeb" stroke="#dc2626" stroke-width="2.6" stroke-linejoin="bevel" />`
      )
    } else if (b.emotion === 'whisper') {
      // 虚线圆角胶囊框（耳语/低语）
      elements.push(
        `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="${(bh * 0.42).toFixed(1)}" fill="#ffffff" stroke="#52525b" stroke-width="2" stroke-dasharray="6,4" />`
      )
    } else if (b.emotion === 'narration') {
      // 双线矩形旁白框
      elements.push(
        `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="4" fill="#f8fafc" stroke="#1e293b" stroke-width="2.4" />`,
        `<rect x="${(bx + 4).toFixed(1)}" y="${(by + 4).toFixed(1)}" width="${Math.max(4, bw - 8).toFixed(1)}" height="${Math.max(4, bh - 8).toFixed(1)}" rx="2" fill="none" stroke="#94a3b8" stroke-width="1" />`
      )
    } else {
      // 标准椭圆漫剧气泡（normal / thought）
      elements.push(
        `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${(bw * 0.5).toFixed(1)}" ry="${(bh * 0.5).toFixed(1)}" fill="#ffffff" stroke="#18181b" stroke-width="2.2" />`
      )
    }

    // 渲染多行自适应居中文字
    const cleanText = b.text
    const maxCharsPerLine = Math.max(6, Math.floor(bw / 16))
    const lines: string[] = []
    for (let i = 0; i < cleanText.length; i += maxCharsPerLine) {
      lines.push(cleanText.slice(i, i + maxCharsPerLine))
    }
    const fontSize = clamp(Math.round(Math.min(bw, bh) * 0.18), 12, 22)
    const lineHeight = fontSize * 1.28
    const startY = cy - (lines.length - 1) * lineHeight * 0.5 + fontSize * 0.35

    lines.forEach((ln, idx) => {
      const ly = startY + idx * lineHeight
      elements.push(
        `<text x="${cx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="${fontSize}" font-weight="${b.emotion === 'shout' ? '700' : '500'}" fill="${b.emotion === 'shout' ? '#991b1b' : '#18181b'}">${escapeXml(ln)}</text>`
      )
    })
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`,
    ...elements.map((el) => `  ${el}`),
    `</svg>`
  ].join('\n')
}
