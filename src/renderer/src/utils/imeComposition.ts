/**
 * 输入法（IME）组词期的守卫判定。
 *
 * 为什么单独成文件：这是「中文输入时第一个字母无效」这个 bug 的契约所在。
 *
 * 根因：`RefMentionTextarea` 的 `@input` 一有变化就把值 emit 给宿主，宿主（节点卡）
 * 随即更新节点参数并 bumpRevision。组词中的拼音还没上屏，这一写回会重建 textarea 的
 * `value`，而**改写 value 会让浏览器丢弃正在进行的组词** —— 用户看到的就是
 * 「第一个字母敲下去没反应」，字母被输入法清掉了，第二个字母才重新成组。
 *
 * 正确做法：组词期间（CompositionEvent 之间，或 input 事件自带 isComposing）
 * 完全不回写宿主，等 `compositionend` 再一次性上屏。
 */

export interface CompositionInputLike {
  /** Chromium 在组词期间的 input 事件上会置 true（少数路径只靠它才判得出来） */
  isComposing?: boolean
}

/**
 * 本次输入是否属于组词（不该回写宿主）。
 *
 * @param composing 组件自己跟踪的组词状态（compositionstart/compositionend 之间）
 * @param event 触发本次输入的 input 事件
 */
export function isCompositionInput(
  composing: boolean,
  event?: CompositionInputLike | null
): boolean {
  return composing || event?.isComposing === true
}
