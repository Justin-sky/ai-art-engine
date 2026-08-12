const INSTRUCTION_MENTION_RE = /@(\d+)/g

export interface RefMentionOption {
  token: string
  label: string
  kind: 'visual' | 'voice'
  /** 选中后实际写入文本；省略时写入 token（生成指令继续使用 @n） */
  insertText?: string
}

export interface InstructionMentionSource {
  /** 1-based，与 UI / @n 一致（含风格图占位偏移） */
  index: number
  title: string
  text: string
  /**
   * 为 true 时保留 `@n` 原文（图/视频等媒体指代，供 API 按 image[] 顺序解析）。
   * 文本类引用仍展开为正文。
   */
  keepMentionToken?: boolean
}

/** 图/视频/声音源在最终提示词中保留 `@n`，不展开成正文 */
export function shouldKeepInstructionMentionToken(
  node: { assetType?: string; typeId?: string } | null | undefined
): boolean {
  if (!node) return false
  if (node.assetType === 'image' || node.assetType === 'video' || node.assetType === 'voice') {
    return true
  }
  if (
    node.typeId === 'asset.image' ||
    node.typeId === 'asset.video' ||
    node.typeId === 'asset.voice'
  ) {
    return true
  }
  // 图片/视频/声音加工节点（upscale / gridSplit / select / multiAngle …）：输出媒体，保留 @n。
  // image.toPrompt 输出的是文本提示词，不保留。
  if (
    node.typeId?.startsWith('image.') ||
    node.typeId?.startsWith('video.') ||
    node.typeId?.startsWith('voice.')
  ) {
    if (node.typeId !== 'image.toPrompt') return true
  }
  if (
    node.typeId === 'media.bundle' ||
    node.typeId === 'output.image' ||
    node.typeId === 'output.video' ||
    node.typeId === 'output.voice'
  ) {
    return true
  }
  return false
}

/**
 * 将指令中的 @1 / @2 替换为对应上游正文。
 * - 文本源：命中则只保留正文（不保留 @n）
 * - 媒体源（keepMentionToken）：保留 `@n` 给图/视频 API
 * - 未命中：去掉该 @n
 */
export function expandInstructionMentions(
  instruction: string,
  sources: InstructionMentionSource[]
): string {
  if (!instruction) return ''
  const byIndex = new Map(sources.map((s) => [s.index, s]))
  return instruction
    .replace(INSTRUCTION_MENTION_RE, (_match, num: string) => {
      const index = Number(num)
      const hit = byIndex.get(index)
      if (!hit) return ''
      if (hit.keepMentionToken) return `@${index}`
      const body = hit.text.trim()
      if (body) return body
      const title = hit.title.trim()
      // 标题若只是占位 @n，也不保留
      if (!title || /^@\d+$/.test(title)) return ''
      return title
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim()
}

/** 指令中出现过的引用编号 */
export function collectMentionedIndexes(instruction: string): Set<number> {
  const indexes = new Set<number>()
  instruction.replace(INSTRUCTION_MENTION_RE, (_m, num: string) => {
    indexes.add(Number(num))
    return _m
  })
  return indexes
}

/** 指令中是否出现任意 `@n` */
export function instructionHasMentions(instruction: string): boolean {
  return collectMentionedIndexes(instruction).size > 0
}

/**
 * 按指令中的 `@` 筛选已编号输入：
 * - 无任意 `@`：全部保留（自动引入）
 * - 有任意 `@`：只保留被引用编号的项
 */
export function selectByMentionIndexes<T>(
  instruction: string,
  indexed: Array<{ index: number; value: T }>
): T[] {
  const mentioned = collectMentionedIndexes(instruction)
  if (mentioned.size === 0) return indexed.map((entry) => entry.value)
  return indexed.filter((entry) => mentioned.has(entry.index)).map((entry) => entry.value)
}
