<script setup lang="ts">
/**
 * Dive：Semantic Timeline 三层只读编辑器 + 对比面板。
 * 与其它 dive 视图一致：接收 EditorDiveChildHost 展开的扁平 props（勿再包一层 meta）。
 */
import { computed, inject, onMounted, ref, watch } from 'vue'
import type { SemanticTimeline } from '@shared/semanticTimeline'
import SemanticTimelineEditor from '../SemanticTimelineEditor.vue'
import SemanticCompareView from '../SemanticCompareView.vue'
import EditorDiveBar from '../EditorDiveBar.vue'
import { editorDiveKey } from '../../features/graph/model/editorDive'

/**
 * 浮层里保留 dive 自己的返回条（宿主 provide 的上下文）。
 * 没有宿主上下文（例如独立窗口打开）时为 null，不渲染返回条。
 */
const injectedDive = inject(editorDiveKey, null)
const diveBar = computed(() =>
  injectedDive
    ? {
        rootTitle: injectedDive.rootTitle,
        frames: injectedDive.frames,
        popTo: injectedDive.popTo
      }
    : null
)

const props = defineProps<{
  frameKey: string
  timelineId: string
  sourceAssetId?: string
  sourceRelativePath?: string
  resultRelativePath?: string
  timelineJson?: string
}>()

const timeline = ref<SemanticTimeline | null>(null)
const error = ref('')
const originalUrl = ref('')
const resultUrl = ref('')

const timelineId = computed(() => props.timelineId?.trim() ?? '')

function parseInline(raw: string | undefined): SemanticTimeline | null {
  const text = raw?.trim()
  if (!text) return null
  try {
    const doc = JSON.parse(text) as SemanticTimeline
    if (doc && typeof doc === 'object' && typeof doc.id === 'string') return doc
  } catch {
    /* not json */
  }
  return null
}

async function load(): Promise<void> {
  error.value = ''
  timeline.value = null
  originalUrl.value = ''
  resultUrl.value = ''

  const inline = parseInline(props.timelineJson)
  if (inline) {
    timeline.value = inline
  } else {
    const id = timelineId.value
    if (!id) {
      error.value = 'missing timelineId'
      return
    }
    try {
      const text = await window.studio.readProjectFile(`Semantic/${id}/timeline.json`)
      if (text?.trim()) {
        timeline.value = JSON.parse(text) as SemanticTimeline
      }
      if (!timeline.value) error.value = 'timeline not found'
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  try {
    if (props.resultRelativePath) {
      resultUrl.value = (await window.studio.getAssetFileUrl(props.resultRelativePath)) ?? ''
    }
    if (props.sourceRelativePath) {
      originalUrl.value = (await window.studio.getAssetFileUrl(props.sourceRelativePath)) ?? ''
    }
  } catch {
    /* preview urls optional */
  }
}

onMounted(() => {
  void load()
})
watch(
  () => [props.timelineId, props.timelineJson, props.sourceRelativePath, props.resultRelativePath],
  () => {
    void load()
  }
)
</script>

<template>
  <!--
    这个视图**直接铺满整个窗口**（不再有全屏按钮/开关）：
    `Teleport to="body"` 把它搬到文档顶层，绕开宿主那层布局（dive 平时只占画布区），
    再用 `position: fixed; inset: 0` 盖住应用左右面板。
    顶部保留 dive 自带的返回条（宿主 provide 的上下文），否则盖住它就没法退出 —— Esc 不做处理。
  -->
  <Teleport to="body">
    <div class="dive-semantic dive-view dive-fullscreen">
      <div v-if="diveBar" class="dive-shell-bar">
        <EditorDiveBar
          :root-title="diveBar.rootTitle"
          :frames="diveBar.frames"
          @pop-to="diveBar.popTo"
        />
      </div>
      <p v-if="error" class="err">{{ error }}</p>
      <SemanticTimelineEditor v-if="timeline" :timeline="timeline" />
      <SemanticCompareView
        v-if="originalUrl && resultUrl"
        class="compare"
        :original-url="originalUrl"
        :result-url="resultUrl"
      />
    </div>
  </Teleport>
</template>

<style scoped>
.dive-semantic {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  /* 外层只在「窗口太矮、编辑器到 min-height 还放不下」时兜底滚动；
     正常情况下高度由编辑器内部的滚动区承担，横向滚动条就贴在可见区底部 */
  overflow: auto;
  padding: 8px;
}
/*
 * 直接全屏：铺满整个窗口（fixed + inset 0），并盖住应用外壳（左右面板 / 工具条）。
 * z-index 取 6000：高于应用内已有的最高弹层（5200），低于 9999 的 OverflowTip —— 悬浮提示仍需可见。
 * 顶部返回条由本组件自己渲染（宿主那份会被浮层盖住）。
 */
.dive-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 6000;
  background: var(--bg-app, var(--bg-panel));
  padding: 0 12px 12px;
  gap: 8px;
}
.dive-fullscreen .dive-shell-bar {
  flex-shrink: 0;
  margin: 0 -12px 4px;
  display: flex;
  align-items: center;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
}
.err {
  color: #f88;
  font-size: 13px;
}
.compare {
  min-height: 220px;
  /* 比对面板不参与挤压编辑器的高度 */
  flex: 0 0 auto;
}
</style>
