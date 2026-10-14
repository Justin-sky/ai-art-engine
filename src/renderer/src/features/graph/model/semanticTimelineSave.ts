import { toPlain } from '../../../utils/toPlain'
import type { SemanticTimeline } from '@shared/semanticTimeline'

/**
 * 落盘载荷：把时间线文档拍成**纯数据**再交给 IPC。
 *
 * 文档在界面里是 Vue 响应式代理（dive 里的 `ref<SemanticTimeline>`），检查器写回的 patch 里
 * 也可能带代理；而 `applySemanticEdit` 是 `{ ...doc }` / `doc.shots.map(...)` 这种浅拷贝 ——
 * 代理会**留在产物里**（数组元素与嵌套对象都是代理）。
 *
 * 代理过 contextBridge / `ipcRenderer.invoke` 要结构化克隆，Chromium 直接报
 * `An object could not be cloned.` —— 用户看到的是「保存失败：An object could not be cloned.」，
 * 每次修改都存不下去（实测踩到）。落盘前统一走这里，别再让代理上桥。
 */
export function semanticTimelineSavePayload(doc: SemanticTimeline): SemanticTimeline {
  return toPlain(doc)
}
