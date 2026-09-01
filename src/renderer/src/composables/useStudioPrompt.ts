import { readonly, shallowRef } from 'vue'
import type { GenerateModelOption } from '../features/graph/model/generateModelOptions'

export type StudioPromptMode = 'alert' | 'confirm' | 'prompt'

export interface StudioPromptOptions {
  title: string
  message: string
  mode?: StudioPromptMode
  confirmLabel?: string
  cancelLabel?: string
  /** prompt 模式：默认文本 */
  defaultValue?: string
  /** prompt 模式：输入框占位 */
  placeholder?: string
  /** prompt 模式：可选模型下拉（传入后显示模型选择） */
  modelOptions?: GenerateModelOption[]
  /** prompt 模式：模型初始选中 key（不传则取首个） */
  initialModelKey?: string
}

interface StudioPromptState extends Required<Pick<StudioPromptOptions, 'title' | 'message' | 'mode'>> {
  confirmLabel?: string
  cancelLabel?: string
  defaultValue?: string
  placeholder?: string
  modelOptions?: GenerateModelOption[]
  modelKey: string
  resolve: (value: boolean | string | null | { text: string; modelKey: string }) => void
}

const current = shallowRef<StudioPromptState | null>(null)

function closePrompt(value: boolean | string | null | { text: string; modelKey: string }): void {
  const active = current.value
  if (!active) return
  current.value = null
  active.resolve(value)
}

function openPrompt(options: StudioPromptOptions): Promise<boolean | string | null | { text: string; modelKey: string }> {
  // 若已有弹窗，先取消旧的，避免卡住
  if (current.value) closePrompt(false)
  return new Promise((resolve) => {
    current.value = {
      title: options.title,
      message: options.message,
      mode: options.mode ?? 'alert',
      confirmLabel: options.confirmLabel,
      cancelLabel: options.cancelLabel,
      defaultValue: options.defaultValue,
      placeholder: options.placeholder,
      modelOptions: options.modelOptions,
      modelKey: options.initialModelKey || options.modelOptions?.[0]?.key || '',
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
  return openPrompt({ ...options, mode: 'confirm' }).then((v) => v === true)
}

/** 文本输入（取消返回 null；确定返回去首尾空白后的字符串，允许空串由调用方校验） */
export function promptText(
  options: Omit<StudioPromptOptions, 'mode'>
): Promise<string | null> {
  return openPrompt({ ...options, mode: 'prompt' }).then((v) => {
    if (typeof v === 'string') return v
    return null
  })
}

/** 文本输入 + 可选模型选择（取消返回 null；确定返回文本与所选模型 key） */
export function promptTextWithModel(
  options: Omit<StudioPromptOptions, 'mode'> & { modelOptions: GenerateModelOption[] }
): Promise<{ text: string; modelKey: string } | null> {
  return openPrompt({ ...options, mode: 'prompt' }).then((v) => {
    if (v && typeof v === 'object' && 'text' in v) {
      return v as { text: string; modelKey: string }
    }
    return null
  })
}

export function useStudioPromptHost() {
  return {
    current: readonly(current),
    confirm: (value?: string, modelKey?: string) => {
      const state = current.value
      if (!state) return
      if (state.mode === 'prompt') {
        // 传入 modelOptions（含空数组）视为「文本 + 模型」弹窗，返回对象
        if (state.modelOptions !== undefined) {
          closePrompt({ text: value ?? '', modelKey: modelKey ?? state.modelKey })
        } else {
          closePrompt(value ?? '')
        }
      } else {
        closePrompt(true)
      }
    },
    cancel: () => closePrompt(modeCancelValue())
  }
}

function modeCancelValue(): boolean | null {
  return current.value?.mode === 'prompt' ? null : false
}
