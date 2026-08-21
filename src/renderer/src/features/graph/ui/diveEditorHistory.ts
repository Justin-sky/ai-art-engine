import { shallowRef } from 'vue'

/**
 * 内嵌（dive）编辑器的细粒度撤销/重做桥。
 *
 * 图层分离等工具在 dive 内维护自己的草稿历史（每次拖动/缩放/层序为一步，纯内存、
 * 关窗即弃），不进主图撤销栈。打开中的内嵌编辑器把历史控制器注册到这里，主窗口工具栏
 * （「一键工作流」旁的 ↶↷）便代理到它——与编辑器共用同一对按钮，无需在编辑器内另设
 * 撤销/重做。控制器缺省（active=null）时工具栏回退到主图 editor.commands。
 * 离开编辑器后，整段会话仍由 flush/save 折叠为主图里的一条命令。
 */
export interface DiveEditorHistoryController {
  /** 是否可撤销；在响应式上下文中调用以建立依赖 */
  canUndo: () => boolean
  /** 是否可重做；在响应式上下文中调用以建立依赖 */
  canRedo: () => boolean
  undo: () => void
  redo: () => void
}

class DiveEditorHistoryBridge {
  /** 当前激活的内嵌编辑器历史控制器；null 表示回退到主图命令栈。 */
  readonly active = shallowRef<DiveEditorHistoryController | null>(null)

  /**
   * 编辑器打开时注册，返回注销函数（关窗 / 卸载时调用）。
   * 后注册者覆盖前者；注销按身份保护，避免误清后开编辑器的控制器。
   */
  register(controller: DiveEditorHistoryController): () => void {
    this.active.value = controller
    return () => {
      if (this.active.value === controller) this.active.value = null
    }
  }
}

export const diveEditorHistory = new DiveEditorHistoryBridge()
