<script setup lang="ts">
/**
 * Dive：Semantic Timeline 三层只读编辑器 + 对比面板。
 * 与其它 dive 视图一致：接收 EditorDiveChildHost 展开的扁平 props（勿再包一层 meta）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import type { SemanticTimeline } from '@shared/semanticTimeline'
import SemanticTimelineEditor from '../SemanticTimelineEditor.vue'
import SemanticCompareView from '../SemanticCompareView.vue'

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
  <div class="dive-semantic dive-view">
    <p v-if="error" class="err">{{ error }}</p>
    <SemanticTimelineEditor v-if="timeline" :timeline="timeline" />
    <SemanticCompareView
      v-if="originalUrl && resultUrl"
      class="compare"
      :original-url="originalUrl"
      :result-url="resultUrl"
    />
  </div>
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
