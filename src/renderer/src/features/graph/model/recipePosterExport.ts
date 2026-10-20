import {
  embedGraphInPngDataUrl,
  isCanvasSafeImageSrc,
  type GraphDocument,
  type GraphNode
} from '@shared/graph'

function loadSafeImage(src: string): Promise<HTMLImageElement | null> {
  const clean = src?.trim() ?? ''
  if (!clean || !isCanvasSafeImageSrc(clean)) return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = clean
  })
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const chars = Array.from(text.trim())
  const lines: string[] = []
  let current = ''
  for (const ch of chars) {
    const next = current + ch
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current)
      if (lines.length >= maxLines) {
        lines[lines.length - 1] = `${lines[lines.length - 1]!.slice(0, -1)}…`
        return lines
      }
      current = ch
    } else {
      current = next
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current)
  }
  return lines
}

function extractPrimaryPrompt(nodes: GraphNode[]): string {
  for (const node of nodes) {
    const p =
      node.params?.generateInstruction?.trim() ||
      node.params?.imageLayerSplit?.prompt?.trim() ||
      node.params?.multiAnglePrompt?.trim() ||
      node.params?.lightingPrompt?.trim() ||
      node.params?.notes?.trim()
    if (p) return p
  }
  return ''
}

/**
 * 渲染高颜值「AI 艺术工程配方海报 PNG」，并将完整 `GraphDocument` 隐写进 PNG `tEXt (aiae:graph)` 块。
 * 任何人将导出的海报 PNG 拖回画布即可 100% 复现整张节点图与提示词参数。
 */
export async function buildRecipePosterPngDataUrl(input: {
  graph: GraphDocument
  title?: string
  heroImageSrc?: string
  locale?: string
}): Promise<string> {
  const isEn = /^en/i.test(input.locale ?? 'zh-CN')
  const W = 1080
  const H = 1360
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('RECIPE_POSTER_CANVAS_UNAVAILABLE')

  // 1) 深邃流光背景
  const bgGrad = ctx.createLinearGradient(0, 0, W, H)
  bgGrad.addColorStop(0, '#090d16')
  bgGrad.addColorStop(0.5, '#0f172a')
  bgGrad.addColorStop(1, '#1e1b4b')
  ctx.fillStyle = bgGrad
  ctx.fillRect(0, 0, W, H)

  // 装饰网格与柔光光晕
  ctx.save()
  const glow = ctx.createRadialGradient(W * 0.5, 420, 40, W * 0.5, 420, 520)
  glow.addColorStop(0, 'rgba(56, 189, 248, 0.18)')
  glow.addColorStop(0.6, 'rgba(99, 102, 241, 0.08)')
  glow.addColorStop(1, 'rgba(15, 23, 42, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)
  ctx.restore()

  // 外框金线
  ctx.save()
  drawRoundedRect(ctx, 28, 28, W - 56, H - 56, 28)
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.38)'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.restore()

  // 2) 顶部品牌与标题栏
  ctx.fillStyle = '#fbbf24'
  ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  ctx.fillText('⚡ AI ART ENGINE · WORKFLOW RECIPE', 64, 86)

  const titleText =
    input.title?.trim() || (isEn ? 'AI Node Graph Creative Recipe' : 'AI 节点图创作配方卡')
  ctx.fillStyle = '#f8fafc'
  ctx.font = 'bold 36px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  ctx.fillText(titleText.slice(0, 26), 64, 136)

  // 3) 主视觉展示区 (y: 168 .. 808, h: 640)
  const heroX = 64
  const heroY = 168
  const heroW = W - 128
  const heroH = 620
  ctx.save()
  drawRoundedRect(ctx, heroX, heroY, heroW, heroH, 22)
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.clip()

  const heroImg = input.heroImageSrc ? await loadSafeImage(input.heroImageSrc) : null
  if (heroImg && heroImg.naturalWidth > 0 && heroImg.naturalHeight > 0) {
    const scale = Math.min(heroW / heroImg.naturalWidth, heroH / heroImg.naturalHeight)
    const dw = heroImg.naturalWidth * scale
    const dh = heroImg.naturalHeight * scale
    const dx = heroX + (heroW - dw) / 2
    const dy = heroY + (heroH - dh) / 2
    ctx.drawImage(heroImg, dx, dy, dw, dh)
  } else {
    // 无预览图时绘制精致拓扑示意图
    ctx.fillStyle = '#64748b'
    ctx.font = 'bold 26px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(
      isEn ? '✨ Node Graph Pipeline Ready' : '✨ 节点管线拓扑已就绪',
      heroX + heroW / 2,
      heroY + heroH / 2
    )
    ctx.textAlign = 'left'
  }
  ctx.restore()

  // 4) 节点管线胶囊链 (y: 825)
  ctx.fillStyle = '#94a3b8'
  ctx.font = 'bold 18px sans-serif'
  ctx.fillText(isEn ? 'PIPELINE TOPOLOGY' : '画布节点管线拓扑', 64, 836)

  const nodes = (input.graph.nodes ?? []).slice(0, 6)
  let pillX = 64
  const pillY = 856
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    const label = `${i + 1}. ${(node.title || node.typeId || 'Node').slice(0, 14)}`
    ctx.font = 'bold 18px sans-serif'
    const tw = ctx.measureText(label).width
    const pw = tw + 28
    if (pillX + pw > W - 64) break
    drawRoundedRect(ctx, pillX, pillY, pw, 42, 12)
    ctx.fillStyle = 'rgba(56, 189, 248, 0.14)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.fillStyle = '#e0f2fe'
    ctx.fillText(label, pillX + 14, pillY + 27)
    pillX += pw + 12
    if (i < nodes.length - 1 && pillX + 26 < W - 64) {
      ctx.fillStyle = '#fbbf24'
      ctx.fillText('➔', pillX - 4, pillY + 27)
      pillX += 20
    }
  }

  // 5) 核心提示词配方框 (y: 930 .. 1180)
  const promptBoxY = 930
  const promptBoxH = 240
  drawRoundedRect(ctx, 64, promptBoxY, W - 128, promptBoxH, 18)
  ctx.fillStyle = 'rgba(15, 23, 42, 0.78)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)'
  ctx.lineWidth = 1.5
  ctx.stroke()

  ctx.fillStyle = '#38bdf8'
  ctx.font = 'bold 18px sans-serif'
  ctx.fillText(isEn ? 'PROMPT & PARAMETERS RECIPE' : '核心提示词与参数配方', 92, promptBoxY + 38)

  const promptText =
    extractPrimaryPrompt(input.graph.nodes ?? []) ||
    (isEn
      ? 'Multi-node visual production workflow built in AI Art Engine.'
      : '使用 AI Art Engine 构建的多节点视觉生产管线。')
  ctx.fillStyle = '#cbd5e1'
  ctx.font = '21px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  const lines = wrapLines(ctx, promptText, W - 184, 5)
  lines.forEach((line, idx) => {
    ctx.fillText(line, 92, promptBoxY + 80 + idx * 32)
  })

  // 6) 底部隐写复现提示横幅
  const footY = 1205
  drawRoundedRect(ctx, 64, footY, W - 128, 92, 16)
  const footGrad = ctx.createLinearGradient(64, footY, W - 64, footY + 92)
  footGrad.addColorStop(0, 'rgba(245, 158, 11, 0.18)')
  footGrad.addColorStop(1, 'rgba(99, 102, 241, 0.22)')
  ctx.fillStyle = footGrad
  ctx.fill()
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.45)'
  ctx.lineWidth = 1.5
  ctx.stroke()

  ctx.fillStyle = '#fef08a'
  ctx.font = 'bold 21px sans-serif'
  ctx.fillText(
    isEn
      ? '🪄 Workflow-in-PNG Embedded · Drag into AI Art Engine to Restore Graph'
      : '🪄 已内嵌节点图基因 (Workflow-in-PNG) · 将此图拖入软件画布即可一键还原整套节点与参数',
    90,
    footY + 42
  )
  ctx.fillStyle = '#94a3b8'
  ctx.font = '16px sans-serif'
  ctx.fillText(
    `${input.graph.nodes.length} Nodes · ${input.graph.edges.length} Edges · Lossless tEXt(aiae:graph) Metadata`,
    90,
    footY + 72
  )

  const rawPngDataUrl = canvas.toDataURL('image/png')
  return embedGraphInPngDataUrl(rawPngDataUrl, input.graph)
}
