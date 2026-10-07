import { ref } from 'vue'

/**
 * 跨组件的「打开一键工作流对话框」请求。
 *
 * ## 为什么要这个薄桥
 *
 * 对话框挂在 `StudioView`，它持有 `useAiCreateWorkflow()` 的全部状态（预设选择、模型、
 * 宽高比、预览…）。那份状态**不能提到模块作用域共享** —— 编排器内部会调用 Pinia store
 * （`useProjectStore` / `useGraphRunLogsStore`），而 Pinia 只能在组件 setup 里取用，
 * 在模块加载期调用会直接失败。
 *
 * 因此这里不搬运状态，只传一个「请打开」的信号：工作区的「新建」入口 +1，
 * `StudioView` 监听后调用自己的 `openDialog()`。对话框仍只有一个实例、一份状态。
 */
export const aiWorkflowOpenRequest = ref(0)

/** 请求打开「一键工作流」对话框（由工作区「新建」入口调用） */
export function requestAiWorkflowDialog(): void {
  aiWorkflowOpenRequest.value += 1
}
