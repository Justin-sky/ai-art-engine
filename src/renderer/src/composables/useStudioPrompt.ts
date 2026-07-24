import { readonly, shallowRef } from 'vue'

export type StudioPromptMode = 'alert' | 'confirm'

export interface StudioPromptOptions {
  title: string
  message: string
  mode?: StudioPromptMode
  confirmLabel?: string
  cancelLabel?: string
}

interface StudioPromptState extends Required<Pick<StudioPromptOptions, 'title' | 'message' | 'mode'>> {
  confirmLabel?: string
  cancelLabel?: string
  resolve: (ok: boolean) => void
}

const current = shallowRef<StudioPromptState | null>(null)

function closePrompt(ok: boolean): void {
  const active = current.value
  if (!active) return
  current.value = null
  active.resolve(ok)
}

function openPrompt(options: StudioPromptOptions): Promise<boolean> {
  // 若已有弹窗，先取消旧的，避免卡住
  if (current.value) closePrompt(false)
  return new Promise<boolean>((resolve) => {
    current.value = {
      title: options.title,
      message: options.message,
      mode: options.mode ?? 'alert',
      confirmLabel: options.confirmLabel,
      cancelLabel: options.cancelLabel,
      resolve
    }
  })
}

/** 提示（仅「知道了」） */
export function promptAlert(options: Omit<StudioPromptOptions, 'mode'>): Promise<void> {
  return openPrompt({ ...options, mode: 'alert' }).then(() => undefined)
}

/** 确认（取消 / 确定），返回是否确定 */
export function promptConfirm(options: Omit<StudioPromptOptions, 'mode'>): Promise<boolean> {
  return openPrompt({ ...options, mode: 'confirm' })
}

export function useStudioPromptHost() {
  return {
    current: readonly(current),
    confirm: () => closePrompt(true),
    cancel: () => closePrompt(false)
  }
}
