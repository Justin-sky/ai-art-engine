import { computed, readonly, ref } from 'vue'
import type { EditorEventBus } from './events'

export interface EditorCommand {
  id: string
  label: string
  scope?: string
  mergeKey?: string
  execute: () => void | Promise<void>
  undo?: () => void | Promise<void>
}

interface ExecutedCommand {
  command: EditorCommand
}

interface CommandHistory {
  undo: ExecutedCommand[]
  redo: ExecutedCommand[]
}

/**
 * 修改入口与 Undo/Redo 栈。现有编辑逻辑可逐步迁移，不要求一次改完。
 * 没有 undo 的命令仍可执行，但不会进入历史。
 */
export class EditorCommandService {
  private readonly histories = new Map<string, CommandHistory>()
  private readonly revision = ref(0)
  private readonly activeScopeRef = ref('global')
  private readonly running = ref(false)

  readonly isRunning = readonly(this.running)
  readonly activeScope = readonly(this.activeScopeRef)
  readonly canUndo = computed(() => {
    void this.revision.value
    return this.history().undo.length > 0 && !this.running.value
  })
  readonly canRedo = computed(() => {
    void this.revision.value
    return this.history().redo.length > 0 && !this.running.value
  })

  constructor(private readonly events: EditorEventBus) {}

  async execute(command: EditorCommand): Promise<void> {
    if (this.running.value) throw new Error('Another editor command is already running')
    this.running.value = true
    try {
      await command.execute()
      if (command.undo) {
        const scope = command.scope ?? this.activeScopeRef.value
        const history = this.history(scope)
        const previous = history.undo.at(-1)
        if (command.mergeKey && previous?.command.mergeKey === command.mergeKey) {
          history.undo[history.undo.length - 1] = {
            command: {
              ...command,
              scope,
              undo: previous.command.undo
            }
          }
        } else {
          history.undo.push({ command: { ...command, scope } })
        }
        history.redo = []
        this.touch()
      }
      this.events.emit('command:executed', { commandId: command.id })
    } finally {
      this.running.value = false
    }
  }

  /** 拖拽等交互已实时作用于模型时，只记录其最终命令，不重复 execute。 */
  recordExecuted(command: EditorCommand): void {
    if (!command.undo) return
    const scope = command.scope ?? this.activeScopeRef.value
    const history = this.history(scope)
    history.undo.push({ command: { ...command, scope } })
    history.redo = []
    this.touch()
    this.events.emit('command:executed', { commandId: command.id })
  }

  async undo(): Promise<void> {
    const history = this.history()
    const entry = history.undo.at(-1)
    if (!entry?.command.undo || this.running.value) return
    this.running.value = true
    try {
      await entry.command.undo()
      history.undo.pop()
      history.redo.push(entry)
      this.touch()
    } finally {
      this.running.value = false
    }
  }

  async redo(): Promise<void> {
    const history = this.history()
    const entry = history.redo.at(-1)
    if (!entry || this.running.value) return
    this.running.value = true
    try {
      await entry.command.execute()
      history.redo.pop()
      history.undo.push(entry)
      this.touch()
    } finally {
      this.running.value = false
    }
  }

  /** 指定作用域是否有可撤销历史（不依赖当前活动作用域） */
  canUndoInScope(scope: string): boolean {
    const history = this.histories.get(scope)
    return !!history && history.undo.length > 0 && !this.running.value
  }

  /** 指定作用域是否存在撤销历史（不判断命令是否执行中） */
  hasUndoInScope(scope: string): boolean {
    return !!this.histories.get(scope)?.undo.length
  }

  /** 指定作用域是否有可重做历史（不依赖当前活动作用域） */
  canRedoInScope(scope: string): boolean {
    const history = this.histories.get(scope)
    return !!history && history.redo.length > 0 && !this.running.value
  }

  /** 指定作用域是否存在重做历史（不判断命令是否执行中） */
  hasRedoInScope(scope: string): boolean {
    return !!this.histories.get(scope)?.redo.length
  }

  /** 撤销指定作用域的最新命令（不切换活动作用域） */
  async undoInScope(scope: string): Promise<void> {
    const history = this.histories.get(scope)
    const entry = history?.undo.at(-1)
    if (!entry?.command.undo || this.running.value) return
    this.running.value = true
    try {
      await entry.command.undo()
      history!.undo.pop()
      history!.redo.push(entry)
      this.touch()
    } finally {
      this.running.value = false
    }
  }

  /** 重做指定作用域的最新命令（不切换活动作用域） */
  async redoInScope(scope: string): Promise<void> {
    const history = this.histories.get(scope)
    const entry = history?.redo.at(-1)
    if (!entry || this.running.value) return
    this.running.value = true
    try {
      await entry.command.execute()
      history!.redo.pop()
      history!.undo.push(entry)
      this.touch()
    } finally {
      this.running.value = false
    }
  }

  setActiveScope(scope: string): void {
    if (this.activeScopeRef.value === scope) return
    this.activeScopeRef.value = scope
    this.touch()
  }

  clearHistory(scope = this.activeScopeRef.value): void {
    this.histories.delete(scope)
    this.touch()
  }

  clearAllHistories(): void {
    this.histories.clear()
    this.activeScopeRef.value = 'global'
    this.touch()
  }

  private history(scope = this.activeScopeRef.value): CommandHistory {
    let history = this.histories.get(scope)
    if (!history) {
      history = { undo: [], redo: [] }
      this.histories.set(scope, history)
    }
    return history
  }

  private touch(): void {
    this.revision.value += 1
  }
}
