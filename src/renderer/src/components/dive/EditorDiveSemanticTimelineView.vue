<script setup lang="ts">
/**
 * Dive：Semantic Timeline 三层编辑器 + 结构化「修改」面板（镜头 / 台词 / 实体 / 逐镜提示词覆盖）
 * + 对比面板。修改是本工作流**唯一**的修改入口：直接落盘时间线，编译据基线判断要重做什么。
 * 与其它 dive 视图一致：接收 EditorDiveChildHost 展开的扁平 props（勿再包一层 meta）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import {
  applySemanticEdit,
  buildPromptPlan,
  collectRulePacks,
  compileDirectorCommands,
  migrateSemanticTimeline,
  type SemanticEditInput,
  type SemanticPack,
  type SemanticTimeline,
  type ShotEvidence,
  type UtteranceEvidence,
  type VideoPromptPlan
} from '@shared/semanticTimeline'
import SemanticTimelineEditor from '../SemanticTimelineEditor.vue'
import SemanticEditPanel from '../SemanticEditPanel.vue'
import SemanticCompareView from '../SemanticCompareView.vue'
import { useStudioI18n } from '../../composables/useStudioI18n'

const { t, locale } = useStudioI18n()

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
    /**
     * 内联文档来自上游节点的运行输出（修改**前**的那份）；修改是直接落盘的。
     * 磁盘上有更新的版本就用磁盘的 —— 否则重开 dive 看不到之前的修改，再改一次还会把它们覆盖掉。
     */
    const disk = await readDiskTimeline(inline.id)
    if (disk && isNewerDoc(disk, inline)) timeline.value = disk
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

  // v1 → v2：内联镜头树 / 台词（需要证据）；修改面板靠它
  if (timeline.value) timeline.value = await toV2(timeline.value)

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

async function readDiskTimeline(id: string | undefined): Promise<SemanticTimeline | null> {
  const stl = id?.trim()
  if (!stl?.startsWith('stl.')) return null
  try {
    const text = await window.studio.readProjectFile(`Semantic/${stl}/timeline.json`)
    return text?.trim() ? (JSON.parse(text) as SemanticTimeline) : null
  } catch {
    return null
  }
}

function isNewerDoc(a: SemanticTimeline, b: SemanticTimeline): boolean {
  const ea = a.edits?.length ?? 0
  const eb = b.edits?.length ?? 0
  if (ea !== eb) return ea > eb
  const ta = Date.parse(a.updatedAt ?? '')
  const tb = Date.parse(b.updatedAt ?? '')
  return Number.isFinite(ta) && Number.isFinite(tb) && ta > tb
}

async function toV2(doc: SemanticTimeline): Promise<SemanticTimeline> {
  if ((doc.shots?.length ?? 0) > 0 && doc.baseline) return migrateSemanticTimeline(doc)
  let evidence: { shots?: ShotEvidence[]; utterances?: UtteranceEvidence[] } = {}
  if (doc.id && window.studio.semanticLoadEvidence) {
    try {
      const ev = await window.studio.semanticLoadEvidence(doc.id)
      evidence = { shots: ev?.shots ?? [], utterances: ev?.utterances ?? [] }
    } catch {
      /* 没有证据：只迁 schema，修改面板给"没有镜头"的提示 */
    }
  }
  return migrateSemanticTimeline(doc, evidence)
}

// ─── 结构化修改（镜头 / 台词 / 实体） ────────────────────────────────────────────

const editError = ref('')
const saving = ref(false)

/**
 * 应用一次修改并**立即落盘**（`timeline.json`）。编译节点读时间线时会优先用磁盘上更新的版本，
 * 所以改完重跑编译 / 重建即可生效。落盘失败时回滚到修改前，并把原因显示出来。
 */
async function applyEdit(input: SemanticEditInput): Promise<void> {
  const before = timeline.value
  if (!before) return
  editError.value = ''
  let next: SemanticTimeline
  try {
    next = applySemanticEdit(before, input)
  } catch (e) {
    editError.value = e instanceof Error ? e.message : String(e)
    return
  }
  timeline.value = next
  saving.value = true
  try {
    await window.studio.semanticSaveTimeline(next)
  } catch (e) {
    timeline.value = before
    editError.value = `${t('graph.semanticEdit.saveFailed')}${e instanceof Error ? e.message : String(e)}`
  } finally {
    saving.value = false
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

// ─── 当前提示词（只读，给修改面板做参照） ────────────────────────────────────────

/**
 * 渲染侧用 `buildPromptPlan` 按当前时间线（含修改）重算一份计划，只用来在修改面板里
 * **显示每镜现在会用的提示词**（提示词覆盖框的参照）。口径与编译执行器一致
 * （导演规则 + 结构化镜头）；真正的计划仍以编译节点的运行结果为准。
 */
const localPlan = ref<VideoPromptPlan | null>(null)

async function buildLocalPlan(): Promise<void> {
  const doc = timeline.value
  if (!doc) {
    localPlan.value = null
    return
  }
  try {
    let shots: ShotEvidence[] = []
    let utterances: UtteranceEvidence[] = []
    if (!doc.shots?.length && doc.id && window.studio.semanticLoadEvidence) {
      try {
        const evidence = await window.studio.semanticLoadEvidence(doc.id)
        shots = evidence?.shots ?? []
        utterances = evidence?.utterances ?? []
      } catch {
        /* 读不到证据：没有参照提示词，不影响修改 */
      }
    }
    let packs: SemanticPack[] = []
    try {
      packs = (await window.studio.semanticListPacks()) ?? []
    } catch {
      packs = []
    }
    const commands = compileDirectorCommands(doc, { rulePacks: collectRulePacks(packs) })
    localPlan.value = buildPromptPlan({
      timeline: doc,
      shots,
      utterances,
      commands,
      sourceRelativePath: props.sourceRelativePath,
      lang: locale.value.toLowerCase().startsWith('en') ? 'en' : 'zh'
    })
  } catch {
    localPlan.value = null
  }
}

watch([() => timeline.value?.id, () => timeline.value?.updatedAt], () => void buildLocalPlan(), {
  immediate: true
})

/** shotId → 当前会用的提示词 */
const promptByShot = computed((): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const shot of localPlan.value?.shots ?? []) out[shot.shotId] = shot.prompt
  return out
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
    <SemanticTimelineEditor v-if="timeline" :timeline="timeline" />
    <SemanticEditPanel
      v-if="timeline && timeline.id"
      :timeline="timeline"
      :prompt-by-shot="promptByShot"
      :error="editError"
      @edit="applyEdit"
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
