<script setup lang="ts">
/**
 * Dive：Semantic Timeline 三层只读编辑器 + 对比面板。
 * 与其它 dive 视图一致：接收 EditorDiveChildHost 展开的扁平 props（勿再包一层 meta）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import type { SemanticTimeline } from '@shared/semanticTimeline'
import SemanticTimelineEditor from '../SemanticTimelineEditor.vue'
import SemanticCompareView from '../SemanticCompareView.vue'
import { useStudioI18n } from '../../composables/useStudioI18n'
import { graphEditorHosts } from '../../features/graph/model/graphEditorHosts'

const { t } = useStudioI18n()

const props = defineProps<{
  frameKey: string
  timelineId: string
  sourceAssetId?: string
  sourceRelativePath?: string
  resultRelativePath?: string
  timelineJson?: string
  /** 来源节点（语义编辑 / 变体）：编辑操作在 dive 里做，改动写回这个节点的参数 */
  editorNodeId?: string
  hostId?: string
}>()

const timeline = ref<SemanticTimeline | null>(null)
/**
 * 编辑操作在 **dive** 里做（不在 inspector）：这里把编辑列表**读自 / 写回**来源节点参数。
 * 节点参数仍是唯一事实来源 —— 构建还是走画布上的节点运行。
 */
const canEdit = computed(() => !!props.editorNodeId?.trim() && !!props.hostId?.trim())
const editsJson = computed(() => {
  void graphEditorHosts.revision.value
  const hostId = props.hostId?.trim()
  const nodeId = props.editorNodeId?.trim()
  if (!hostId || !nodeId) return ''
  const node = graphEditorHosts.getNode(hostId, nodeId)
  const raw = node?.params?.editsJson
  return typeof raw === 'string' ? raw : ''
})

function persistEdits(value: string): void {
  const hostId = props.hostId?.trim()
  const nodeId = props.editorNodeId?.trim()
  if (!hostId || !nodeId) return
  // updateNode（而非 Live 版）：记撤销 + 触发自动保存 —— 这是用户的编辑
  graphEditorHosts.updateNode(hostId, nodeId, { editsJson: value })
}
const error = ref('')
/** 「还没有时间线」不是错误：透传节点未接上游时就是这种状态，给提示而不是报错 */
const hint = ref('')
const missingPath = ref('')
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
  hint.value = ''
  missingPath.value = ''
  timeline.value = null
  originalUrl.value = ''
  resultUrl.value = ''

  const inline = parseInline(props.timelineJson)
  if (inline) {
    timeline.value = inline
  } else {
    const id = timelineId.value
    if (!id) {
      /**
       * 没有 id 也没有内联 JSON：**不是错误**。
       * 语义时间线是透传节点，未接上游（或上游还没产出）时就是这个状态 ——
       * 以前这种情况会被塞一个假 id 进来，然后报 `timeline not found`，让人以为是坏了。
       */
      hint.value = t('graph.semanticTimeline.noTimelineHint')
      return
    }
    const rel = `Semantic/${id}/timeline.json`
    try {
      const text = await window.studio.readProjectFile(rel)
      if (text?.trim()) {
        timeline.value = JSON.parse(text) as SemanticTimeline
      }
      if (!timeline.value) {
        error.value = t('graph.semanticTimeline.timelineFileMissing')
        missingPath.value = rel
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      missingPath.value = rel
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
    与其它 dive 视图一致：**就地**渲染在宿主编辑器的位置上（只占画布区），
    面包屑/返回条由宿主统一渲染（`.dive-shell-bar` + EditorDiveBar）——
    本视图不自带返回条、也不做全屏浮层。
  -->
  <div class="dive-semantic dive-view">
    <p v-if="error" class="err">
      {{ error }}
      <span v-if="missingPath" class="path">{{ missingPath }}</span>
    </p>
    <div v-else-if="hint" class="hint">
      <p>{{ hint }}</p>
      <p class="hint-sub">{{ t('graph.semanticTimeline.noTimelineHintSub') }}</p>
    </div>
    <SemanticTimelineEditor
      v-if="timeline"
      :timeline="timeline"
      :edits-json="editsJson"
      :can-edit="canEdit"
      @update:edits-json="persistEdits"
    />
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
.err .path {
  display: block;
  margin-top: 4px;
  color: var(--text-muted);
  font-family: Consolas, monospace;
  font-size: 12px;
}
/* 「还没有时间线」是提示，不是错误：用常规色 + 说明下一步怎么做 */
.hint {
  color: var(--text);
  font-size: 13px;
  line-height: 1.7;
}
.hint-sub {
  color: var(--text-muted);
  font-size: 12px;
}
.compare {
  min-height: 220px;
  /* 比对面板不参与挤压编辑器的高度 */
  flex: 0 0 auto;
}
</style>
