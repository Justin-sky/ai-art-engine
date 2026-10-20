/**
 * 画布「自然语言批处理宏编译器」（Canvas Macro & Batch Selector Compiler）
 *
 * 将一句中/英文自然语言批处理指令（如：
 * 「把所有人像节点改为清透冷白皮+一寸蓝底，把所有打光节点开启暖金轮廓光，把所有分镜切为 16:9」）
 * 本地 0 延迟编译为结构化的节点补丁计划（`CanvasMacroPlan`），支持 Dry-Run 变更预览与一键整批应用。
 */

import { lightingSetupToNodePatch, normalizeLightingSetup } from './lightingSetup'
import {
  normalizePortraitRetouch,
  portraitRetouchToNodePatch,
  type PortraitIdPhotoBg,
  type PortraitIdPhotoSpecId,
  type PortraitLutId,
  type PortraitRetouchState,
  type PortraitTier
} from './portraitRetouch'
import type { GraphDocument, GraphNode, GraphNodeParams } from './types'

export interface CanvasMacroNodeDiff {
  nodeId: string
  nodeTitle: string
  nodeTypeId: string
  summaryZh: string[]
  summaryEn: string[]
  paramsPatch: Partial<GraphNodeParams>
  lockedPatch?: boolean
}

export interface CanvasMacroPlan {
  instruction: string
  matchedNodeCount: number
  diffs: CanvasMacroNodeDiff[]
}

function isPortraitCapableNode(node: GraphNode): boolean {
  return node.typeId === 'image.portrait' || Boolean(node.params?.portraitRetouch)
}

function isLightingCapableNode(node: GraphNode): boolean {
  return node.typeId === 'image.lighting' || Boolean(node.params?.lightingSetup)
}

function isAspectRatioCapableNode(node: GraphNode): boolean {
  const tid = node.typeId ?? ''
  return (
    tid === 'image.generate' ||
    tid === 'video.generate' ||
    tid === 'film.storyboard' ||
    tid === 'comic.page' ||
    tid === 'asset.motion' ||
    'generateAspectRatio' in (node.params ?? {})
  )
}

function parseRequestedTier(clause: string, fallback: PortraitTier = 'standard'): PortraitTier {
  if (/拉满|极强|最大|\bmax\b/i.test(clause)) return 'max'
  if (/强力|深度|重度|高|\bstrong\b/i.test(clause)) return 'strong'
  if (/轻度|轻微|微调|\blight\b/i.test(clause)) return 'light'
  if (/关闭|关掉|取消|\boff\b/i.test(clause)) return 'off'
  return fallback
}

/**
 * 将自然语言批处理指令编译为可预览、可回滚的 `CanvasMacroPlan`
 */
export function compileNaturalLanguageCanvasMacro(
  instruction: string,
  doc: GraphDocument,
  options?: { selectedNodeIds?: readonly string[] }
): CanvasMacroPlan {
  const raw = instruction.trim()
  if (!raw || !Array.isArray(doc.nodes) || doc.nodes.length === 0) {
    return { instruction: raw, matchedNodeCount: 0, diffs: [] }
  }

  const selectedSet = new Set(options?.selectedNodeIds ?? [])
  const onlySelected = selectedSet.size > 0 && /选中|当前所选|selected/i.test(raw)

  const candidateNodes = doc.nodes.filter((n) => !onlySelected || selectedSet.has(n.id))

  // 1. 解析画幅比例规则
  let targetAspectRatio: string | null = null
  const aspectMatch = raw.match(/\b(16:9|9:16|1:1|4:3|3:4|21:9)\b/)
  if (aspectMatch) {
    targetAspectRatio = aspectMatch[1]!
  } else if (/电影宽画幅|超宽屏|21比9/i.test(raw)) {
    targetAspectRatio = '21:9'
  } else if (/横屏|宽屏|16比9/i.test(raw)) {
    targetAspectRatio = '16:9'
  } else if (/竖屏|9比16/i.test(raw)) {
    targetAspectRatio = '9:16'
  } else if (/方图|正方形|1比1/i.test(raw)) {
    targetAspectRatio = '1:1'
  }

  // 2. 解析人像精修规则
  const portraitPatch: Partial<PortraitRetouchState> = {}
  const portraitSummaryZh: string[] = []
  const portraitSummaryEn: string[] = []

  const setLut = (lut: PortraitLutId, zh: string, en: string): void => {
    portraitPatch.lutId = lut
    portraitSummaryZh.push(`滤镜 → ${zh}`)
    portraitSummaryEn.push(`LUT → ${en}`)
  }

  if (/冷白皮|清透冷调|cool\s*porcelain/i.test(raw)) {
    portraitPatch.skinWhiten = 'strong'
    portraitPatch.skinSmoothing = 'standard'
    portraitPatch.colorTemp = 'coolLight'
    portraitPatch.lutId = 'coolFilm'
    portraitSummaryZh.push('套用「清透冷白皮」配方')
    portraitSummaryEn.push('Apply Cool Porcelain recipe')
  }

  if (/富士|fuji/i.test(raw)) {
    setLut('fuji', '富士胶片', 'Fuji Film')
  } else if (/港风|复古港|hong\s*kong/i.test(raw)) {
    setLut('hongkong', '港风复古', 'HK Vintage')
  } else if (/柯达|kodak/i.test(raw)) {
    setLut('kodak', '柯达暖调', 'Kodak Warm')
  } else if (/黑金|black\s*gold/i.test(raw)) {
    setLut('blackGold', '黑金大刊', 'Black-Gold')
  } else if (/黑白胶片|黑白滤镜|\bbw\b/i.test(raw)) {
    setLut('bw', '黑白胶片', 'B&W Film')
  }

  if (/磨皮|skin\s*smooth/i.test(raw)) {
    const tier = parseRequestedTier(raw, 'standard')
    portraitPatch.skinSmoothing = tier
    portraitSummaryZh.push(`磨皮 → ${tier}`)
    portraitSummaryEn.push(`Skin smoothing → ${tier}`)
  }
  if (/美白|提亮肤色|whiten/i.test(raw) && !portraitPatch.skinWhiten) {
    const tier = parseRequestedTier(raw, 'strong')
    portraitPatch.skinWhiten = tier
    portraitSummaryZh.push(`美白 → ${tier}`)
    portraitSummaryEn.push(`Skin whiten → ${tier}`)
  }
  if (/瘦脸|face\s*slim/i.test(raw)) {
    const tier = parseRequestedTier(raw, 'standard')
    portraitPatch.faceSlim = tier
    portraitSummaryZh.push(`瘦脸 → ${tier}`)
    portraitSummaryEn.push(`Face slim → ${tier}`)
  }
  if (/大眼|亮眼|eye\s*size/i.test(raw)) {
    const tier = parseRequestedTier(raw, 'standard')
    portraitPatch.eyeSize = tier
    portraitSummaryZh.push(`大眼 → ${tier}`)
    portraitSummaryEn.push(`Eye size → ${tier}`)
  }

  // 证件照规格与底色
  const specMap: Array<[RegExp, PortraitIdPhotoSpecId, string]> = [
    [/小一寸|small\s*one\s*inch/i, 'smallOneInch', '小一寸'],
    [/大一寸|large\s*one\s*inch/i, 'largeOneInch', '大一寸'],
    [/小二寸|small\s*two\s*inch/i, 'smallTwoInch', '小二寸'],
    [/二寸|two\s*inch/i, 'twoInch', '二寸'],
    [/一寸|one\s*inch/i, 'oneInch', '一寸'],
    [/护照|签证|passport|visa/i, 'passport', '护照/签证']
  ]
  for (const [re, specId, label] of specMap) {
    if (re.test(raw)) {
      portraitPatch.idPhotoSpecId = specId
      portraitSummaryZh.push(`证件照规格 → ${label}`)
      portraitSummaryEn.push(`ID photo spec → ${specId}`)
      break
    }
  }

  const bgMap: Array<[RegExp, PortraitIdPhotoBg, string]> = [
    [/蓝底|blue\s*(bg|backdrop|background)/i, 'blue', '标准蓝底'],
    [/白底|white\s*(bg|backdrop|background)/i, 'white', '纯白底'],
    [/红底|red\s*(bg|backdrop|background)/i, 'red', '中国红底'],
    [/渐变底|gradient\s*(bg|backdrop)/i, 'gradient', '商务灰渐变底']
  ]
  for (const [re, bgId, label] of bgMap) {
    if (re.test(raw)) {
      portraitPatch.idPhotoBg = bgId
      portraitSummaryZh.push(`证件照底色 → ${label}`)
      portraitSummaryEn.push(`ID photo backdrop → ${bgId}`)
      break
    }
  }

  // 3. 解析 2.5D 打光规则
  const lightingPatch: Record<string, unknown> = {}
  const lightingSummaryZh: string[] = []
  const lightingSummaryEn: string[] = []

  if (/伦勃朗|rembrandt/i.test(raw)) {
    lightingPatch.presetId = 'rembrandt'
    lightingPatch.yaw = 45
    lightingPatch.pitch = 25
    lightingPatch.brightness = 88
    lightingSummaryZh.push('光位 → 伦勃朗 45° 侧主光')
    lightingSummaryEn.push('Lighting → Rembrandt 45°')
  } else if (/蝴蝶光|美人光|butterfly/i.test(raw)) {
    lightingPatch.yaw = 0
    lightingPatch.pitch = 42
    lightingPatch.brightness = 92
    lightingSummaryZh.push('光位 → 蝴蝶光正面高位柔光')
    lightingSummaryEn.push('Lighting → Butterfly front-high')
  } else if (/侧逆光|split\s*light/i.test(raw)) {
    lightingPatch.yaw = -85
    lightingPatch.pitch = 15
    lightingSummaryZh.push('光位 → 戏剧侧逆光')
    lightingSummaryEn.push('Lighting → Dramatic split light')
  }

  const brightnessMatch = raw.match(/(?:亮度|brightness)\s*(?:调到|设为|改为|=|:)?\s*(\d{1,3})/i)
  if (brightnessMatch) {
    const bVal = Math.max(0, Math.min(100, Number(brightnessMatch[1])))
    lightingPatch.brightness = bVal
    lightingSummaryZh.push(`亮度 → ${bVal}`)
    lightingSummaryEn.push(`Brightness → ${bVal}`)
  }

  if (/暖金|夕阳|黄金时刻|warm\s*gold|sunset/i.test(raw)) {
    lightingPatch.color = '#ff9944'
    lightingSummaryZh.push('光色 → 暖金夕阳 (#ff9944)')
    lightingSummaryEn.push('Light color → Warm Sunset (#ff9944)')
  } else if (/赛博|冰蓝|清冷月光|cyber|cyan\s*light/i.test(raw)) {
    lightingPatch.color = '#48d4ff'
    lightingSummaryZh.push('光色 → 赛博冰蓝 (#48d4ff)')
    lightingSummaryEn.push('Light color → Cyber Cyan (#48d4ff)')
  }

  if (/轮廓光|边缘光|rim\s*light/i.test(raw)) {
    const turnOff = /关闭轮廓光|取消轮廓光|no\s*rim/i.test(raw)
    lightingPatch.rimLight = !turnOff
    lightingSummaryZh.push(turnOff ? '关闭菲涅尔轮廓光' : '开启菲涅尔轮廓光')
    lightingSummaryEn.push(turnOff ? 'Disable rim light' : 'Enable rim light')
  }

  // 4. 节点锁定/解锁
  const lockAction: boolean | undefined = /解锁|unlock/i.test(raw)
    ? false
    : /锁定|lock/i.test(raw)
      ? true
      : undefined

  // 5. 针对每个候选节点生成补丁
  const diffs: CanvasMacroNodeDiff[] = []
  const hasPortraitOps = Object.keys(portraitPatch).length > 0
  const hasLightingOps = Object.keys(lightingPatch).length > 0

  for (const node of candidateNodes) {
    const summaryZh: string[] = []
    const summaryEn: string[] = []
    const paramsPatch: Partial<GraphNodeParams> = {}
    let lockedPatch: boolean | undefined

    if (hasPortraitOps && isPortraitCapableNode(node)) {
      const merged = normalizePortraitRetouch({
        ...(node.params?.portraitRetouch ?? {}),
        ...portraitPatch
      })
      Object.assign(paramsPatch, portraitRetouchToNodePatch(merged))
      summaryZh.push(...portraitSummaryZh)
      summaryEn.push(...portraitSummaryEn)
    }

    if (hasLightingOps && isLightingCapableNode(node)) {
      const merged = normalizeLightingSetup({
        ...(node.params?.lightingSetup ?? {}),
        ...lightingPatch
      })
      Object.assign(paramsPatch, lightingSetupToNodePatch(merged))
      summaryZh.push(...lightingSummaryZh)
      summaryEn.push(...lightingSummaryEn)
    }

    if (targetAspectRatio && isAspectRatioCapableNode(node)) {
      paramsPatch.generateAspectRatio = targetAspectRatio
      summaryZh.push(`画幅比例 → ${targetAspectRatio}`)
      summaryEn.push(`Aspect ratio → ${targetAspectRatio}`)
    }

    if (lockAction !== undefined) {
      lockedPatch = lockAction
      summaryZh.push(lockAction ? '节点 → 已锁定' : '节点 → 已解锁')
      summaryEn.push(lockAction ? 'Node → Locked' : 'Node → Unlocked')
    }

    if (summaryZh.length > 0) {
      diffs.push({
        nodeId: node.id,
        nodeTitle: node.title || node.typeId || node.id,
        nodeTypeId: node.typeId || 'unknown',
        summaryZh,
        summaryEn,
        paramsPatch,
        ...(lockedPatch !== undefined ? { lockedPatch } : {})
      })
    }
  }

  return {
    instruction: raw,
    matchedNodeCount: diffs.length,
    diffs
  }
}

/**
 * 将编译好的 `CanvasMacroPlan` 批量无损应用到 `GraphDocument`，返回新文档（支持一键撤销）
 */
export function applyCanvasMacroPlan(doc: GraphDocument, plan: CanvasMacroPlan): GraphDocument {
  if (!plan.diffs.length) return doc
  const diffMap = new Map(plan.diffs.map((d) => [d.nodeId, d]))

  const nextNodes = doc.nodes.map((node) => {
    const diff = diffMap.get(node.id)
    if (!diff) return node
    return {
      ...node,
      ...(diff.lockedPatch !== undefined ? { locked: diff.lockedPatch } : {}),
      params: {
        ...(node.params ?? {}),
        ...diff.paramsPatch
      }
    }
  })

  return {
    ...doc,
    nodes: nextNodes
  }
}
