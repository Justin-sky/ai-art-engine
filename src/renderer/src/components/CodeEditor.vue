<template>
  <div ref="hostEl" class="code-editor" :class="{ ready }" />
</template>

<script setup lang="ts">
/**
 * 懒加载的 Monaco 代码编辑器（脚本节点用）。
 *
 * - Monaco 很重：只在组件挂载时**动态 import**，不进首屏 bundle。
 * - worker 走 Vite 的 `?worker` 规约（editor + ts），语言服务跑在 worker 里，
 *   编辑大段代码不卡 UI 线程。
 * - 通过 `extraLib` 注入 `inputs` / `om` / 返回值的 TS 类型 → 敲 `om.` / `inputs.in[0].`
 *   有补全和提示，这是降低"不知道里面有什么"门槛的关键。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  modelValue: string
  /** 注入到编辑器的全局类型声明（.d.ts 文本）；变化时热替换 */
  extraLib?: string
  readonly?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; change: [] }>()

const hostEl = ref<HTMLElement | null>(null)
const ready = ref(false)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let editor: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let monacoRef: any = null
let extraLibDisposable: { dispose(): void } | null = null
let suppressChange = false

async function setupMonacoEnvironment(): Promise<void> {
  if ((globalThis as { MonacoEnvironment?: unknown }).MonacoEnvironment) return
  const [{ default: EditorWorker }, { default: TsWorker }] = await Promise.all([
    import('monaco-editor/esm/vs/editor/editor.worker?worker'),
    import('monaco-editor/esm/vs/language/typescript/ts.worker?worker')
  ])
  ;(globalThis as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
    getWorker(_id: string, label: string) {
      if (label === 'typescript' || label === 'javascript') return new TsWorker()
      return new EditorWorker()
    }
  }
}

function applyExtraLib(): void {
  if (!monacoRef) return
  extraLibDisposable?.dispose()
  extraLibDisposable = null
  if (props.extraLib) {
    extraLibDisposable = monacoRef.languages.typescript.javascriptDefaults.addExtraLib(
      props.extraLib,
      'ts:script-node-globals.d.ts'
    )
  }
}

onMounted(async () => {
  await setupMonacoEnvironment()
  const monaco = await import('monaco-editor')
  monacoRef = monaco
  if (!hostEl.value) return

  monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    allowNonTsExtensions: true,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    lib: ['esnext']
  })
  applyExtraLib()

  editor = monaco.editor.create(hostEl.value, {
    value: props.modelValue,
    language: 'javascript',
    theme: 'vs-dark',
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    tabSize: 2,
    scrollBeyondLastLine: false,
    readOnly: props.readonly === true,
    renderWhitespace: 'none'
  })

  editor.onDidChangeModelContent(() => {
    if (suppressChange) return
    emit('update:modelValue', editor.getValue())
    emit('change')
  })
  ready.value = true
})

watch(
  () => props.modelValue,
  (next) => {
    if (!editor || next === editor.getValue()) return
    suppressChange = true
    editor.setValue(next)
    suppressChange = false
  }
)
watch(() => props.extraLib, applyExtraLib)
watch(
  () => props.readonly,
  (ro) => editor?.updateOptions({ readOnly: ro === true })
)

onBeforeUnmount(() => {
  extraLibDisposable?.dispose()
  editor?.dispose()
})
</script>

<style scoped>
.code-editor {
  width: 100%;
  min-height: 240px;
  flex: 1 1 auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.code-editor.ready {
  opacity: 1;
}
</style>
