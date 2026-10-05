import { normalizeStageControls } from '@shared/domain'
import type { StageControlPreferences } from '@shared/domain'
import { applyEditorPreferences } from '../../editor/preferences'

/**
 * 把 3D 视口灵敏度落盘。
 *
 * 为什么需要这个 helper：导演台浮层里调完滑块要**持久化**，但设置页的
 * `persistSettings` 带着防抖、locale、autosave 等一堆上下文，不适合被工具栏调用。
 *
 * 写入方式是「读当前设置 → 只替换 editor.stage → 整体写回」：
 * `setSettings` 是整体替换语义，不先读盘会把其它字段清掉。
 *
 * 顺带把返回值再喂给 `applyEditorPreferences` —— 主进程会按区间钳制，
 * 这一步保证界面上的滑块位置与真正生效的值一致（不会出现「显示 3 实际 2」）。
 */
export async function persistStageControls(
  stage: StageControlPreferences
): Promise<StageControlPreferences> {
  const current = await window.studio.getSettings()
  const saved = await window.studio.setSettings({
    ...current,
    editor: {
      ...current.editor,
      stage: normalizeStageControls(stage)
    }
  })
  applyEditorPreferences(saved)
  return saved.editor.stage
}
