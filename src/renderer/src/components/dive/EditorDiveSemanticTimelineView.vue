<script setup lang="ts">
/**
 * Dive：Semantic Timeline 三层只读编辑器 + 对比面板 + 逐镜提示词面板。
 * 与其它 dive 视图一致：接收 EditorDiveChildHost 展开的扁平 props（勿再包一层 meta）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import {
  buildPromptPlan,
  collectRulePacks,
  compileDirectorCommands,
  parsePromptPlan,
  type SemanticPack,
  type SemanticTimeline,
  type ShotEvidence,
  type UtteranceEvidence,
  type VideoPromptPlan
} from '@shared/semanticTimeline'
import SemanticTimelineEditor from '../SemanticTimelineEditor.vue'
import SemanticPromptPanel from '../SemanticPromptPanel.vue'
import SemanticCompareView from '../SemanticCompareView.vue'
import { useStudioI18n } from '../../composables/useStudioI18n'
import { graphEditorHosts } from '../../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../../features/graph/model/graphRunHosts'

const { t, locale } = useStudioI18n()

const props = defineProps<{
  frameKey: string
  timelineId: string
  sourceAssetId?: string
  sourceRelativePath?: string
  resultRelativePath?: string
  timelineJson?: string
  /** 来源节点（语义编译）：提示词覆盖写回这个节点的 `promptOverridesJson` */
  editorNodeId?: string
  hostId?: string
}>()

const timeline = ref<SemanticTimeline | null>(null)

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
       * 上游还没产出时间线时就是这个状态 ——
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

// ─── 逐镜提示词（编译节点的覆盖入口） ──────────────────────────────────────────

/**
 * 面板**只在从编译节点双击进来时可写**：`editorNodeId` + `hostId` 由 `editorDive.ts`
 * 的 meta 传入（`GraphNodeCard.openSemanticTimelineDive` 在 `semantic.compile` 上设置）。
 * 纯查看（从分析节点双击）时右栏没有提示词页签 —— 没有可写目标，给了也是假按钮。
 */
const canEditPrompts = computed(() => !!props.editorNodeId?.trim() && !!props.hostId?.trim())

const editorNode = computed(() => {
  const hostId = props.hostId?.trim()
  const nodeId = props.editorNodeId?.trim()
  if (!hostId || !nodeId) return null
  return graphEditorHosts.getNode(hostId, nodeId)
})

const promptOverridesJson = computed(() => {
  const raw = editorNode.value?.params?.promptOverridesJson
  return typeof raw === 'string' ? raw : ''
})

function persistPromptOverrides(value: string): void {
  const hostId = props.hostId?.trim()
  const nodeId = props.editorNodeId?.trim()
  if (!hostId || !nodeId) return
  // updateNode（而非 Live 版）：记撤销 + 触发自动保存 —— 这是用户的编辑
  graphEditorHosts.updateNode(hostId, nodeId, { promptOverridesJson: value })
}

function rulePackIds(): string[] {
  return String(editorNode.value?.params?.rulePackIds || '')
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * 计划来源 ①：编译节点的**运行输出**（`out` 是 `aiart.video-prompts@1`）。
 *
 * 优先它：它带着模型是否参与、以及上次运行时的提示词原文。
 */
const planFromRun = computed((): VideoPromptPlan | null => {
  const hostId = props.hostId?.trim()
  const nodeId = props.editorNodeId?.trim()
  if (!hostId || !nodeId) return null
  // runStates 是 reactive 对象：节点跑完会自动重算
  const out = graphRunHosts.get(hostId)?.runStates?.[nodeId]?.outputs?.out
  if (!out) return null
  if (out.kind === 'videoPrompts') return out.plan
  if (out.kind === 'text') return parsePromptPlan(out.text)
  return null
})

/**
 * 计划来源 ②：**渲染侧本地用 `buildPromptPlan` 重算**。
 *
 * 为什么要有这条路：编译节点没跑过（或工程重开后运行输出不在内存里）时，
 * 只看 ① 会让面板全空 —— 而用户来这一趟就是为了改提示词。
 * 口径与执行器一致（规则包 + 导演命令 + 证据镜头）。
 */
const localPlan = ref<VideoPromptPlan | null>(null)
const planLoading = ref(false)
const planError = ref('')

async function buildLocalPlan(): Promise<void> {
  localPlan.value = null
  planError.value = ''
  const doc = timeline.value
  if (!doc) return
  planLoading.value = true
  try {
    let shots: ShotEvidence[] = []
    let utterances: UtteranceEvidence[] = []
    if (doc.id && window.studio.semanticLoadEvidence) {
      try {
        const evidence = await window.studio.semanticLoadEvidence(doc.id)
        shots = evidence?.shots ?? []
        utterances = evidence?.utterances ?? []
      } catch {
        /* 读不到证据不是错误：下面按 0 镜给提示 */
      }
    }
    let packs: SemanticPack[] = []
    try {
      packs = (await window.studio.semanticListPacks()) ?? []
    } catch {
      packs = []
    }
    const commands = compileDirectorCommands(doc, {
      rulePacks: collectRulePacks(packs, rulePackIds())
    })
    localPlan.value = buildPromptPlan({
      timeline: doc,
      shots,
      utterances,
      commands,
      sourceRelativePath: props.sourceRelativePath,
      lang: locale.value.toLowerCase().startsWith('en') ? 'en' : 'zh'
    })
  } catch (e) {
    planError.value = e instanceof Error ? e.message : String(e)
  } finally {
    planLoading.value = false
  }
}

watch(
  [() => timeline.value?.id, () => props.editorNodeId, () => props.hostId],
  () => {
    // 有运行输出就以它为准（本地重算只是"没有输出时也别空着"的兜底）
    if (!planFromRun.value) void buildLocalPlan()
  },
  { immediate: true }
)

const plan = computed(() => planFromRun.value ?? localPlan.value)

/** 面板为空时要说清**为什么**空（没时间线 / 没镜头证据），不能留一片空白 */
const promptEmptyHint = computed(() => {
  if (!timeline.value) return t('graph.semanticPrompt.noTimeline')
  if ((plan.value?.shots.length ?? 0) === 0) return t('graph.semanticPrompt.noShots')
  return t('graph.semanticPrompt.empty')
})
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
    <SemanticTimelineEditor v-if="timeline" :timeline="timeline" :show-prompt-tab="canEditPrompts">
      <template #prompt-panel>
        <SemanticPromptPanel
          :plan="plan"
          :overrides-json="promptOverridesJson"
          :loading="planLoading"
          :error="planError"
          :empty-hint="promptEmptyHint"
          @update:overrides-json="persistPromptOverrides"
        />
      </template>
    </SemanticTimelineEditor>
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
