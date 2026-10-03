/**
 * 指令框（`@` 引用）插入的纯文本运算。
 *
 * 抽出来的理由是一个真实 bug：`pickOption` 里先 `closeMenu()`（会把 `mentionStart` 重置成
 * `-1`），`nextTick` 回调里才去读 `mentionStart.value` 算光标，于是
 * `cursor = -1 + token.length + 1 = token.length` —— 回车选中引用后，光标跳到了正文开头
 * 附近（`@N` 之前），而不是落在刚插入的引用后面。
 *
 * 所以光标位置必须**在插入的那一刻**由入参算出来并返回，调用方不得延后从会被重置的
 * 组件状态里再取一次。
 */
export interface MentionInsertResult {
  /** 替换后的完整文本 */
  text: string
  /** 光标落点：token 及其后那个空格之后 */
  cursor: number
}

/**
 * 用引用 token（如 `@1`）替换 `[mentionStart, caretEnd)` 处的 `@查询串`。
 *
 * @param value        当前文本
 * @param mentionStart `@` 的起始下标
 * @param caretEnd     光标位置（也是要被替换掉的查询串结尾）
 * @param token        插入的引用文本（`insertText` 优先，否则是 `@N`）
 */
export function insertMentionToken(
  value: string,
  mentionStart: number,
  caretEnd: number,
  token: string
): MentionInsertResult {
  const limit = value.length
  const from = Math.max(0, Math.min(mentionStart, limit))
  const to = Math.max(from, Math.min(caretEnd, limit))
  return {
    text: `${value.slice(0, from)}${token} ${value.slice(to)}`,
    cursor: from + token.length + 1
  }
}
