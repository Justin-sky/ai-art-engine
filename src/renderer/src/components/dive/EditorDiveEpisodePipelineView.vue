<template>
  <div class="episode-pipeline-view">
    <div class="pipeline-header">
      <div class="pipeline-title">
        <span class="title-text">{{ assetTitle }}</span>
        <span
          class="step-chip"
          :title="stateStepTitle"
        >{{ t('divePipeline.episode.header.currentStep') }}{{ stateStepLabel }}</span>
      </div>
      <div class="header-actions">
        <span
          v-if="runningCount"
          class="busy-chip"
        >{{ t('divePipeline.episode.header.busyTasks') }}</span>
        <button
          class="ghost-button"
          type="button"
          :disabled="!lastPipelineRunId"
          :title="lastPipelineRunId ? t('divePipeline.episode.header.traceOpen') : t('divePipeline.episode.header.traceNone')"
          @click="openPipelineLog"
        >
          {{ t('divePipeline.episode.header.viewTrace') }}
        </button>
        <button
          class="ghost-button"
          type="button"
          :disabled="refreshing"
          @click="loadAll"
        >
          {{ refreshing ? t('divePipeline.episode.header.refreshing') : t('divePipeline.episode.header.refresh') }}
        </button>
      </div>
    </div>

    <div
      v-if="headerFailReason"
      class="fail-row"
    >
      <span
        class="fail-chip"
        :title="t('divePipeline.episode.header.failReasonTitle')"
      >
        {{ t('divePipeline.episode.header.failPrefix') }}{{ headerFailReason }}
      </span>
    </div>

    <div
      v-if="!graphDoc"
      class="empty-hint"
    >
      {{ t('divePipeline.episode.empty.noGraph') }}
    </div>

    <div
      v-else
      class="pipeline-body"
      :style="pipelineBodyStyle"
    >
      <!-- 左：节拍拆解表 -->
      <section class="panel beats-panel">
        <div class="panel-head">
          <h3>
            {{ t('divePipeline.episode.panel.beats') }}
            <span
              v-if="reviewResult('breakdown') === 'PASS'"
              class="pass-mark"
            >{{ t('divePipeline.episode.state.passedMark') }}</span>
          </h3>
          <div class="panel-actions">
            <button
              type="button"
              :disabled="stageBusy('breakdown')"
              :title="stageBusy('breakdown') ? t('divePipeline.episode.stageBusyTitle.breakdown') : ''"
              @click="regenerateStage('breakdown')"
            >
              {{ stageActionLabel('breakdown') }}
            </button>
            <button
              type="button"
              class="review-button"
              :class="{ ready: reviewReady('breakdown') }"
              :disabled="!reviewReady('breakdown')"
              @click="runReview('breakdown')"
            >
              {{ t('divePipeline.episode.action.directorReview') }}
            </button>
          </div>
        </div>
        <ul class="beat-list">
          <li
            v-for="beat in beats"
            :key="beat.index"
            class="beat-item"
            :class="{ active: activeBeat === beat.index, anchor: beat.anchor }"
            @click="selectBeat(beat)"
          >
            <span class="beat-index">#{{ beat.index }}</span>
            <OverflowTip
              class="beat-summary"
              :text="beat.summary"
            >
              {{ beat.summary }}
            </OverflowTip>
            <span class="beat-meta">
              <span class="intensity">{{ beat.intensity }}</span>
              <span
                v-if="isAnchorBeat(beat)"
                class="anchor-badge"
                :title="t('divePipeline.episode.anchor.badgeTitle')"
              >{{ t('divePipeline.episode.anchor.badge') }}</span>
            </span>
          </li>
          <li
            v-if="!beats.length"
            class="empty-row"
          >
            {{ beatsEmptyLabel }}
          </li>
        </ul>
      </section>

      <div
        class="splitter"
        :class="{ active: draggingSplit === 'left' }"
        @pointerdown="onSplitterDown('left', $event)"
        @pointermove="onSplitterMove($event)"
        @pointerup="onSplitterUp"
        @pointercancel="onSplitterUp"
      />

      <!-- 中：9宫格 -->
      <section class="panel board-panel">
        <div class="panel-head">
          <h3>
            {{ isDirect9 ? t('divePipeline.episode.panel.boardDirect') : t('graph.episodeAgent.title.grid9Storyboard') }}
            <span
              v-if="reviewResult('beatboard') === 'PASS'"
              class="pass-mark"
            >{{ t('divePipeline.episode.state.passedMark') }}</span>
          </h3>
          <div class="panel-actions">
            <button
              type="button"
              :disabled="stageBusy('beatboard')"
              :title="stageBusy('beatboard') ? t('divePipeline.episode.stageBusyTitle.beatboard') : ''"
              @click="regenerateStage('beatboard')"
            >
              {{ stageActionLabel('beatboard') }}
            </button>
            <button
              type="button"
              class="review-button"
              :class="{ ready: reviewReady('beatboard') }"
              :disabled="!reviewReady('beatboard')"
              @click="runReview('beatboard')"
            >
              {{ t('divePipeline.episode.action.directorReview') }}
            </button>
            <button
              type="button"
              class="icon-button"
              :title="t('divePipeline.episode.action.buildGrid9')"
              @click="runAnchorImage"
            >
              <GridIcon
                :rows="3"
                :cols="3"
              />
            </button>
          </div>
        </div>
        <div class="grid-9">
          <button
            v-for="anchor in anchors9"
            :key="anchor.index"
            type="button"
            class="anchor-card"
            :class="{
              active: selectedAnchorIndex === anchor.index,
              pass: anchorReviewStatus() === 'PASS',
              fail: anchorReviewStatus() === 'FAIL'
            }"
            @click="selectedAnchorIndex = anchor.index"
          >
            <span class="anchor-head">
              <b>{{ t('divePipeline.episode.cell.short', { n: anchor.index }) }}</b>
              <span
                v-if="anchor.beatId"
                class="beat-ref"
                :title="t('divePipeline.episode.cell.beatRefTitle')"
              >{{ t('divePipeline.episode.cell.beatRef', { n: anchor.beatId }) }}</span>
              <span class="status-badge">{{ anchorReviewLabel(anchor.index) }}</span>
            </span>
            <OverflowTip
              class="anchor-title"
              :text="anchor.title"
            >
              {{ anchor.title }}
            </OverflowTip>
            <img
              v-if="anchorImageUrl(anchor.index)"
              :src="anchorImageUrl(anchor.index)"
              class="anchor-thumb"
              alt=""
            >
            <span
              v-else
              class="anchor-empty"
            >{{ t('divePipeline.episode.state.noImage') }}</span>
          </button>
          <div
            v-if="!anchors9.length"
            class="empty-row"
          >
            {{ anchorsEmptyLabel }}
          </div>
        </div>
        <p
          v-if="anchors9.length"
          class="hint"
        >
          {{ t('divePipeline.episode.hint.backFromToolbar') }}
        </p>
      </section>

      <div
        class="splitter"
        :class="{ active: draggingSplit === 'right' }"
        @pointerdown="onSplitterDown('right', $event)"
        @pointermove="onSplitterMove($event)"
        @pointerup="onSplitterUp"
        @pointercancel="onSplitterUp"
      />

      <!-- 右：Inspector 式详情 -->
      <section class="panel detail-panel">
        <div class="panel-head">
          <h3 class="breadcrumb">
            {{ breadcrumbTitle }}
          </h3>
        </div>

        <div
          v-if="!isDirect9"
          class="detail-block"
        >
          <div class="detail-head">
            <h4>
              {{ t('divePipeline.episode.detail.grid4', { index: selectedAnchorIndex }) }}
              <span
                v-if="reviewResult('sequence') === 'PASS'"
                class="pass-mark"
              >{{ t('divePipeline.episode.state.passedMark') }}</span>
            </h4>
            <div class="panel-actions">
              <button
                type="button"
                :disabled="stageBusy('sequence')"
                :title="stageBusy('sequence') ? t('divePipeline.episode.stageBusyTitle.sequence') : ''"
                @click="regenerateStage('sequence')"
              >
                {{ stageActionLabel('sequence') }}
              </button>
              <button
                type="button"
                class="review-button"
                :class="{ ready: reviewReady('sequence') }"
                :disabled="!reviewReady('sequence')"
                @click="runReview('sequence')"
              >
                {{ t('divePipeline.episode.action.directorReview') }}
              </button>
              <button
                type="button"
                class="icon-button"
                :title="t('divePipeline.episode.action.buildGrid4')"
                @click="runFourGridImage"
              >
                <GridIcon
                  :rows="2"
                  :cols="2"
                />
              </button>
            </div>
          </div>
          <div class="grid-4">
            <button
              v-for="cell in anchorCells"
              :key="cell.key"
              type="button"
              class="cell-card"
              :class="{ active: selectedCellKey === cell.key }"
              @click="selectCell(cell)"
            >
              <span class="cell-stage">{{ cell.stage }}</span>
              <OverflowTip
                class="cell-desc"
                :text="cell.text"
              >
                {{ cell.text }}
              </OverflowTip>
              <img
                v-if="cellImageUrl(cell.groupIndex, cell.cellIndex)"
                :src="cellImageUrl(cell.groupIndex, cell.cellIndex)"
                class="cell-thumb"
                alt=""
              >
              <span class="status-badge">{{ cellVideoStatusLabel(cell) }}</span>
            </button>
            <div
              v-if="!anchorCells.length"
              class="empty-row"
            >
              {{ cellsEmptyLabel }}
            </div>
          </div>
        </div>

        <div
          v-if="isDirect9"
          class="detail-block"
        >
          <div class="detail-head">
            <h4>
              {{ t('divePipeline.episode.detail.motionDirect') }}
              <span
                v-if="reviewResult('motion') === 'PASS'"
                class="pass-mark"
              >{{ t('divePipeline.episode.state.passedMark') }}</span>
            </h4>
            <div class="panel-actions">
              <button
                type="button"
                :disabled="stageBusy('motion')"
                :title="stageBusy('motion') ? t('divePipeline.episode.stageBusyTitle.motion') : ''"
                @click="regenerateStage('motion')"
              >
                {{ stageActionLabel('motion', isDirect9) }}
              </button>
              <button
                v-if="hasMotionText"
                type="button"
                class="review-button"
                :class="{ ready: reviewReady('motion') }"
                :disabled="!reviewReady('motion')"
                @click="runReview('motion')"
              >
                {{ t('divePipeline.episode.action.directorReview') }}
              </button>
            </div>
          </div>
          <pre
            v-if="activeMotion"
            class="motion-text interactive"
            :title="t('graph.notepad.openHint')"
            @dblclick="openMotionNotepad"
          >{{ activeMotion.text }}</pre>
          <span
            v-else
            class="video-path"
          >{{ stageBusy('motion') ? t('divePipeline.episode.state.generating') : t('divePipeline.episode.state.notGenerated') }}</span>
        </div>

        <div
          v-if="activeCellVideo"
          class="detail-block video-block"
        >
          <h4>{{ t('divePipeline.episode.detail.videoOutput') }}</h4>
          <MediaPreviewPlayer
            v-if="activeVideoUrl"
            kind="video"
            :src="activeVideoUrl"
          />
          <OverflowTip
            class="video-path"
            :text="activeCellVideo"
          >
            {{ activeCellVideo }}
          </OverflowTip>
          <button
            class="ghost-button primary"
            :class="{ 'is-disabled': !canRunCurrentVideo }"
            type="button"
            :disabled="!canRunCurrentVideo"
            :title="videoActionTitle"
            @click="runCurrentVideo"
          >
            {{ videoBusy ? t('divePipeline.episode.state.generating') : t('divePipeline.episode.detail.regenVideo') }}
          </button>
        </div>
        <div
          v-else
          class="detail-block video-block"
        >
          <h4>{{ t('divePipeline.episode.detail.videoOutput') }}</h4>
          <span class="video-path">{{ videoBusy ? t('divePipeline.episode.state.generating') : t('divePipeline.episode.state.notGenerated') }}</span>
          <button
            class="ghost-button primary"
            :class="{ 'is-disabled': !canRunCurrentVideo }"
            type="button"
            :disabled="!canRunCurrentVideo"
            :title="videoActionTitle"
            @click="runCurrentVideo"
          >
            {{ videoBusy ? t('divePipeline.episode.state.generating') : t('divePipeline.episode.detail.generateVideo') }}
          </button>
        </div>

        <div
          v-if="!isDirect9"
          class="detail-block motion-block"
        >
          <div class="detail-head">
            <h4>
              {{ t('divePipeline.episode.detail.motionCell', { key: selectedCellKey }) }}
              <span
                v-if="reviewResult('motion') === 'PASS'"
                class="pass-mark"
              >{{ t('divePipeline.episode.state.passedMark') }}</span>
            </h4>
            <div class="panel-actions">
              <button
                type="button"
                :disabled="stageBusy('motion')"
                :title="stageBusy('motion') ? t('divePipeline.episode.stageBusyTitle.motion') : ''"
                @click="regenerateStage('motion')"
              >
                {{ stageActionLabel('motion', false) }}
              </button>
              <button
                v-if="hasMotionText"
                type="button"
                class="review-button"
                :class="{ ready: reviewReady('motion') }"
                :disabled="!reviewReady('motion')"
                @click="runReview('motion')"
              >
                {{ t('divePipeline.episode.action.directorReview') }}
              </button>
            </div>
          </div>
          <pre
            v-if="activeMotion"
            class="motion-text interactive"
            :title="t('graph.notepad.openHint')"
            @dblclick="openMotionNotepad"
          >{{ activeMotion.text }}</pre>
          <span
            v-else
            class="video-path"
          >{{ stageBusy('motion') ? t('divePipeline.episode.state.generating') : t('divePipeline.episode.state.notGenerated') }}</span>
        </div>
      </section>
    </div>
  </div>
  <GraphTextNotepadDialog
    :open="motionNotepadOpen"
    :title="motionNotepadTitle"
    :text="motionNotepadText"
    :embedded="false"
    @close="closeMotionNotepad"
    @save="saveMotionNotepad"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  GraphDocument,
  GraphNode,
  GraphNodeParams,
  GraphNodeRunState,
  GraphRunLogMeta
} from '@shared/graph'
import OverflowTip from '../OverflowTip.vue'
import GraphTextNotepadDialog from '../GraphTextNotepadDialog.vue'
import MediaPreviewPlayer from '../MediaPreviewPlayer.vue'
import GridIcon from '../icons/GridIcon.vue'
import {
  cloneGraphDocument,
  collectDownstreamNodeIds,
  extractEpisodeBeatNumber,
  parseEpisodeAgentState,
  parseEpisodeBeatBoard,
  parseEpisodeBeatBreakdown,
  parseEpisodeMotionPrompts,
  parseEpisodeSequenceBoard,
  replaceEpisodeMotionPrompt,
  selectEpisodeAnchors,
  titleMatchesEpisodeReview,
  titleMatchesEpisodeStage,
  type EpisodeAgentState,
  type EpisodeAnchorRow,
  type EpisodeBeatRow,
  type EpisodeCellRow,
  type EpisodeMotionRow,
  type EpisodeStageKey
} from '@shared/graph'
import { readEpisodeAgentState } from '../../features/graph/episodeAgentStateIO'
import { graphEditorHosts } from '../../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../../features/graph/model/graphRunHosts'
import { useProjectStore } from '../../stores/project'
import { useGraphTaskStore, type GraphTaskTarget } from '../../stores/graphTasks'
import { useGraphRunLogsStore } from '../../stores/graphRunLogs'
import { useStudioI18n } from '../../composables/useStudioI18n'
import { promptAlert } from '../../composables/useStudioPrompt'

const props = defineProps<{
  frameKey: string
  hostAssetId: string
}>()

const project = useProjectStore()
const taskStore = useGraphTaskStore()
const runLogs = useGraphRunLogsStore()
const { t } = useStudioI18n()
const lastPipelineRunId = ref<string | null>(null)
const motionNotepadOpen = ref(false)
const motionNotepadTitle = ref('')
const motionNotepadText = ref('')
const motionNotepadCell = ref({ groupIndex: 1, cellIndex: 1 })
const runningCount = computed(() => taskStore.runningCount)
const agentState = ref<EpisodeAgentState | null>(null)
const refreshing = ref(false)
/** 刷新计数：强制 graphDoc / anchors / cells 重新读取实时文档 */
const refreshTick = ref(0)
const selectedAnchorIndex = ref(1)
const selectedCell = ref<{ groupIndex: number; cellIndex: number }>({ groupIndex: 1, cellIndex: 1 })
const activeBeat = ref(1)
const urlCache = new Map<string, string>()
/** 本窗口发起的阶段重生成任务；成功写回后才开放导演审核。 */
const regenerationTasks = new Map<string, ReviewTarget>()
/** 已失效（下游内容变更）尚未重新生成的节点；任务入队时禁止复用其旧结果 */
const staleNodeIds = new Set<string>()

/** 三栏宽度（px）：节拍拆解 / 9宫格 / 4宫格，可拖动分隔条调整 */
const leftWidth = ref(240)
const rightWidth = ref(360)
const draggingSplit = ref<'left' | 'right' | null>(null)
let dragSplitStartX = 0
let dragSplitStartLeft = 0
let dragSplitStartRight = 0

const pipelineBodyStyle = computed(() => ({
  gridTemplateColumns: `${leftWidth.value}px 8px minmax(0, 1fr) 8px ${rightWidth.value}px`
}))

function clampWidth(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function onSplitterDown(kind: 'left' | 'right', event: PointerEvent): void {
  if (event.button !== 0) return
  draggingSplit.value = kind
  dragSplitStartX = event.clientX
  dragSplitStartLeft = leftWidth.value
  dragSplitStartRight = rightWidth.value
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onSplitterMove(event: PointerEvent): void {
  if (!draggingSplit.value) return
  const dx = event.clientX - dragSplitStartX
  if (draggingSplit.value === 'left') {
    leftWidth.value = clampWidth(dragSplitStartLeft + dx, 160, 460)
  } else {
    rightWidth.value = clampWidth(dragSplitStartRight + dx, 280, 640)
  }
}

function onSplitterUp(): void {
  draggingSplit.value = null
}

const asset = computed(() => project.assets.find((item) => item.id === props.hostAssetId) ?? null)
const assetTitle = computed(() => asset.value?.name ?? String(t('divePipeline.episode.title.default')))

const graphDoc = computed<GraphDocument | null>(() => {
  void refreshTick.value
  // 优先取当前打开画布的实时文档（含未落盘连线与运行结果），
  // 避免双击「动态格选择」时只读到旧版已保存 graphJson 而误报无数据。
  const live = graphEditorHosts.getLiveAssetDocument(props.hostAssetId)
  if (live) return live
  const raw = asset.value?.genParams?.graphJson
  if (!raw || typeof raw !== 'string') return null
  try {
    return JSON.parse(raw) as GraphDocument
  } catch {
    return null
  }
})

const nodes = computed<GraphNode[]>(() => graphDoc.value?.nodes ?? [])
const runStates = computed<Record<string, GraphNodeRunState>>(
  () => graphDoc.value?.runStates ?? {}
)

function nodeByKey(key: string): GraphNode | undefined {
  return findEpisodeNode(key)
}

/** 阶段生成节点：优先按 episodeStep 参数匹配，标题兜底走共享模块（新旧两代标题兼容） */
function findStageNode(step: EpisodeStageKey): GraphNode | undefined {
  const all = nodes.value
  return (
    all.find((n) => n.typeId === 'prompt.optimize' && n.params?.episodeStep === step) ??
    all.find((n) => n.typeId === 'prompt.optimize' && titleMatchesEpisodeStage(n.title, step))
  )
}

/** 导演审核节点：优先按 episodeReviewTarget 匹配，标题兜底同上（须同时带审核标记与阶段片段） */
function findReviewNode(target: EpisodeStageKey): GraphNode | undefined {
  const all = nodes.value
  return (
    all.find(
      (n) => n.typeId === 'prompt.optimize' && n.params?.episodeReviewTarget === target
    ) ??
    all.find((n) => n.typeId === 'prompt.optimize' && titleMatchesEpisodeReview(n.title, target))
  )
}

function findEpisodeNode(kind: string): GraphNode | undefined {
  if (kind === 'breakdown') {
    return findStageNode('breakdown')
  }
  if (kind === 'beatboard') {
    return findStageNode('beatboard')
  }
  if (kind === 'sequence') {
    return findStageNode('sequence')
  }
  if (kind === 'motion') {
    return findStageNode('motion')
  }
  if (kind === 'review2') {
    return findReviewNode('beatboard')
  }
  if (kind === 'review1') {
    return findReviewNode('breakdown')
  }
  if (kind === 'review3') {
    return findReviewNode('sequence')
  }
  if (kind === 'review4') {
    return findReviewNode('motion')
  }
  const anchorMatch = /^anchor(\d+)$/.exec(kind)
  if (anchorMatch) {
    const index = Number(anchorMatch[1])
    return nodes.value.find(
      (n) => n.typeId === 'episode.anchorSelect' && n.params?.anchorIndex === index
    )
  }
  const imgMatch = /^img(\d+)$/.exec(kind)
  if (imgMatch) {
    const index = Number(imgMatch[1])
    // 一键工作流：格图由「宫格提取·格N」（image.gridSplit 纯切分）产出；
    // 新图优先按 anchorCellIndex 稳定参数定位，旧图回退按标题探测
    const gridSplit =
      nodes.value.find(
        (n) => n.typeId === 'image.gridSplit' && n.params?.anchorCellIndex === index
      ) ??
      nodes.value.find(
        (n) =>
          n.typeId === 'image.gridSplit' &&
          typeof n.title === 'string' &&
          n.title.includes(`宫格提取·格${index}`) // cjk-ok 旧文档兼容探测
      )
    const candidates = [
      gridSplit,
      nodes.value.find(
        (n) =>
          n.typeId === 'asset.image' &&
          n.title?.includes(`锚点图·格${index}`) // cjk-ok 旧文档兼容探测
      ),
      nodes.value.find(
        (n) =>
          n.typeId === 'asset.image' &&
          typeof n.params?.generateInstruction === 'string' &&
          (n.params.generateInstruction as string).includes(`格${index} 的锚点分镜图`) // cjk-ok 旧文档兼容探测
      )
    ].filter((n): n is GraphNode => !!n)
    // 优先返回已生成图片的节点；都没有时按顺序取第一个（用于显示“未生成图”）
    return candidates.find((n) => firstImageRelativePath(n)) ?? candidates[0]
  }
  const videoMatch = /^video(\d+)-(\d+)$/.exec(kind)
  if (videoMatch) {
    const g = Number(videoMatch[1])
    const c = Number(videoMatch[2])
    const cellKey = `${g}-${c}`
    // 新图优先按 motionCellIndex 稳定参数定位，旧图回退按中文标题 / 指令文案探测
    return (
      nodes.value.find(
        (n) => n.typeId === 'asset.video' && n.params?.motionCellIndex === cellKey
      ) ??
      nodes.value.find(
        (n) =>
          n.typeId === 'asset.video' &&
          n.title?.includes(`格${g}-${c}`) // cjk-ok 旧文档兼容探测
      ) ??
      nodes.value.find(
        (n) =>
          n.typeId === 'asset.video' &&
          typeof n.params?.generateInstruction === 'string' &&
          (n.params.generateInstruction as string).includes(`格${g}-${c} 的动态视频`) // cjk-ok 旧文档兼容探测
      )
    )
  }
  return undefined
}

/** 9宫格直出模式：没有 4宫格 sequence 阶段节点，动画师直接为 9 个宫格各拆 1 条动态提示词 */
const isDirect9 = computed(() => !nodeByKey('sequence'))

type ReviewTarget = 'breakdown' | 'beatboard' | 'sequence' | 'motion'

function textFromRunOutput(out: unknown): string {
  if (!out || typeof out !== 'object') return ''
  const value = out as { kind?: string; text?: string; items?: Array<{ text?: string }> }
  if (value.kind === 'text' && typeof value.text === 'string') return value.text.trim()
  if (value.kind === 'texts' && Array.isArray(value.items)) {
    return value.items
      .map((item) => (typeof item.text === 'string' ? item.text.trim() : ''))
      .filter(Boolean)
      .join('\n\n')
  }
  if (typeof value.text === 'string') return value.text.trim()
  return ''
}

function nodeText(key: string): string {
  const node = nodeByKey(key)
  if (!node) return ''
  const fromParams = node.params?.text?.trim()
  if (fromParams) return fromParams
  const fromResult = node.params?.resultText?.trim()
  if (fromResult) return fromResult
  const generated = node.params?.generatedTexts ?? []
  const selected = generated.find((item) => item.id && item.id === node.params?.selectedTextId)
  const fromGallery =
    selected?.text?.trim() || generated.find((item) => item.text?.trim())?.text?.trim() || ''
  if (fromGallery) return fromGallery
  return textFromRunOutput(runStates.value[node.id]?.outputs?.out)
}

/** 生成过程中正文可能被暂时清空：保留上一份可解析文本，避免按钮和预览一起垮掉 */
const lastStageText: Record<ReviewTarget, string> = {
  breakdown: '',
  beatboard: '',
  sequence: '',
  motion: ''
}

function stageText(key: ReviewTarget): string {
  const live = nodeText(key).trim()
  if (live) lastStageText[key] = live
  return live || lastStageText[key]
}

/** 取节点最近一张输出图的相对路径（节点图库或运行结果） */
function firstImageRelativePath(node: GraphNode | undefined): string {
  if (!node) return ''
  // 优先取节点当前选中/最新生成的图，而不是图库里最早的一张：
  // 宫格提取等节点重跑后图库会累积旧切块，显示必须跟随 selectedImageId
  const generated = node.params?.generatedImages ?? []
  const selectedId = node.params?.selectedImageId?.trim()
  const picked =
    (selectedId ? generated.find((item) => item.id === selectedId) : undefined) ??
    generated[generated.length - 1] ??
    generated[0]
  const direct = picked?.relativePath
  if (direct) return direct
  const out = runStates.value[node.id]?.outputs?.out
  if (out?.kind === 'image' && out.relativePath) return out.relativePath
  if (out?.kind === 'images' && out.items[0]?.relativePath) return out.items[0].relativePath
  return ''
}

/** 取节点当前选中/最新视频的相对路径（与 Inspector 选中输出一致） */
function selectedVideoRelativePath(node: GraphNode | undefined): string {
  if (!node) return ''
  const generated = node.params?.generatedVideos ?? []
  const selectedId = node.params?.selectedVideoId?.trim()
  const picked =
    (selectedId ? generated.find((item) => item.id === selectedId) : undefined) ??
    generated[generated.length - 1] ??
    generated[0]
  const direct = picked?.relativePath?.trim()
  if (direct) return direct
  const preview = node.params?.previewRelativePath?.trim()
  if (preview) return preview
  const out = runStates.value[node.id]?.outputs?.out
  if (out?.kind === 'video' && out.relativePath) return out.relativePath
  if (out?.kind === 'videos' && out.items[out.items.length - 1]?.relativePath) {
    return out.items[out.items.length - 1]!.relativePath!
  }
  return ''
}

const scopeKey = computed(
  () =>
    String(
      nodeByKey('breakdown')?.params?.episodeScopeKey?.trim() ||
        props.hostAssetId ||
        'default'
    )
)

const beats = computed<EpisodeBeatRow[]>(() => parseEpisodeBeatBreakdown(stageText('breakdown')))
const anchors9 = computed<EpisodeAnchorRow[]>(() => parseEpisodeBeatBoard(stageText('beatboard')))
const cells36 = computed<EpisodeCellRow[]>(() => parseEpisodeSequenceBoard(stageText('sequence')))
const motions36 = computed<EpisodeMotionRow[]>(() => parseEpisodeMotionPrompts(stageText('motion')))

const anchorCells = computed<EpisodeCellRow[]>(() =>
  cells36.value.filter((cell) => cell.groupIndex === selectedAnchorIndex.value)
)

const beatsEmptyLabel = computed(() =>
  nodeText('breakdown').trim()
    ? t('divePipeline.episode.empty.beatsUnparsed')
    : t('divePipeline.episode.empty.beatsPending')
)
const anchorsEmptyLabel = computed(() =>
  nodeText('beatboard').trim()
    ? t('divePipeline.episode.empty.anchorsUnparsed')
    : t('divePipeline.episode.empty.anchorsPending')
)
const cellsEmptyLabel = computed(() =>
  nodeText('sequence').trim()
    ? t('divePipeline.episode.empty.cellsUnparsed')
    : t('divePipeline.episode.empty.cellsPending')
)

/** 当前选中动态格的展示键（渲染时解析，不参与持久化） */
const selectedCellKey = computed(
  () =>
    t('divePipeline.episode.cell.key', {
      g: selectedCell.value.groupIndex,
      c: selectedCell.value.cellIndex
    }) as string
)

/** 详情面板面包屑标题 */
const breadcrumbTitle = computed(() =>
  isDirect9.value
    ? t('divePipeline.episode.breadcrumb.direct', {
        beat: activeBeat.value,
        cell: selectedAnchorIndex.value
      })
    : t('divePipeline.episode.breadcrumb.cells', {
        beat: activeBeat.value,
        cell: selectedAnchorIndex.value,
        key: `${selectedCell.value.groupIndex}-${selectedCell.value.cellIndex}`
      })
)

const activeMotion = computed<EpisodeMotionRow | null>(() => {
  const { groupIndex, cellIndex } = selectedCell.value
  return (
    motions36.value.find(
      (row) => row.groupIndex === groupIndex && row.cellIndex === cellIndex
    ) ?? null
  )
})

const activeCellVideo = computed<string>(() => {
  const key = `video${selectedCell.value.groupIndex}-${selectedCell.value.cellIndex}`
  return selectedVideoRelativePath(nodeByKey(key))
})

function currentVideoNode(): GraphNode | undefined {
  const { groupIndex, cellIndex } = selectedCell.value
  return nodeByKey(`video${groupIndex}-${cellIndex}`)
}

function isActiveTaskStatus(status: string): boolean {
  return status === 'pending' || status === 'running'
}

function isNodeBusy(nodeId: string | undefined): boolean {
  if (!nodeId) return false
  return taskStore.tasks.some((task) => {
    if (!isActiveTaskStatus(task.status)) return false
    if (task.target.kind !== 'asset' || task.target.assetId !== props.hostAssetId) return false
    return task.nodes.some(
      (node) => node.nodeId === nodeId && isActiveTaskStatus(node.status)
    )
  })
}

function stageBusy(target: ReviewTarget): boolean {
  const nodeId = nodeByKey(target)?.id
  if (!nodeId) return false
  return taskStore.tasks.some((task) => {
    if (!isActiveTaskStatus(task.status)) return false
    if (task.target.kind !== 'asset' || task.target.assetId !== props.hostAssetId) return false
    // 入队后、节点尚未标 pending 时也要锁视频：看本任务汇点是不是该阶段
    if (task.order[task.order.length - 1] === nodeId) return true
    return task.nodes.some(
      (node) => node.nodeId === nodeId && isActiveTaskStatus(node.status)
    )
  })
}

const videoBusy = computed(() => isNodeBusy(currentVideoNode()?.id))

const hasMotionText = computed(() => !!activeMotion.value)

/** 任一阶段「重新生成」进行中时，不允许再点生成视频 */
const pipelineRegenBusy = computed(
  () =>
    stageBusy('breakdown') ||
    stageBusy('beatboard') ||
    stageBusy('sequence') ||
    stageBusy('motion')
)

const canRunCurrentVideo = computed(() => {
  if (pipelineRegenBusy.value || videoBusy.value) return false
  if (!currentVideoNode()) return false
  return hasMotionText.value || !!stageText('motion').trim()
})

const videoActionTitle = computed(() => {
  if (pipelineRegenBusy.value) return t('divePipeline.episode.detail.videoWaitRegen') as string
  if (videoBusy.value) return t('divePipeline.episode.detail.videoRunning') as string
  if (!hasMotionText.value && !stageText('motion').trim()) {
    return t('divePipeline.episode.detail.videoNeedsPrompt') as string
  }
  return ''
})

function stageActionLabel(target: ReviewTarget, direct9 = false): string {
  if (stageBusy(target)) return String(t('divePipeline.episode.state.generating'))
  const hasText = !!stageText(target).trim()
  if (target === 'motion' && direct9) {
    return hasText
      ? String(t('divePipeline.episode.action.regenerate'))
      : String(t('divePipeline.episode.action.generateMotionDirect'))
  }
  if (target === 'motion') {
    return hasText
      ? String(t('divePipeline.episode.action.regenerate'))
      : String(t('divePipeline.episode.action.generateMotion'))
  }
  return hasText ? String(t('divePipeline.episode.action.regenerate')) : String(t('divePipeline.episode.action.generate'))
}

/** 当前格视频的可播放 URL（由 relativePath 解析并缓存） */
const activeVideoUrl = ref('')

async function refreshActiveVideoUrl(): Promise<void> {
  const path = activeCellVideo.value
  activeVideoUrl.value = path ? await fileUrl(path) : ''
}

watch(
  activeCellVideo,
  () => {
    void refreshActiveVideoUrl()
  },
  { immediate: true }
)

const stateStepLabel = computed(() => {
  const step = agentState.value?.current_step ?? ''
  if (step === 'breakdown') return String(t('graph.episodeAgent.title.beatBreakdown'))
  if (step === 'beatboard') return String(t('graph.episodeAgent.title.grid9Storyboard'))
  if (step === 'sequence') {
    return isDirect9.value
      ? String(t('divePipeline.episode.stepLabel.motionDirect'))
      : String(t('graph.episodeAgent.title.grid4Motion'))
  }
  if (step === 'motion') {
    return isDirect9.value
      ? String(t('divePipeline.episode.stepLabel.motionDirect'))
      : String(t('graph.episodeAgent.title.motionPrompt'))
  }
  if (step === 'completed') return String(t('divePipeline.episode.state.completed'))
  return '—'
})

/** 当前步骤的悬停说明：流水线推进到的阶段（内部步骤 id → i18n 键，渲染时解析） */
const stateStepTitle = computed(() => {
  const step = agentState.value?.current_step ?? ''
  if (step === 'breakdown') return String(t('divePipeline.episode.stepHint.breakdown'))
  if (step === 'beatboard') {
    return isDirect9.value
      ? String(t('divePipeline.episode.stepHint.beatboardDirect'))
      : String(t('divePipeline.episode.stepHint.beatboardCells'))
  }
  if (step === 'sequence') {
    return isDirect9.value
      ? String(t('divePipeline.episode.stepHint.readyDirect'))
      : String(t('divePipeline.episode.stepHint.sequenceCells'))
  }
  if (step === 'motion') {
    return isDirect9.value
      ? String(t('divePipeline.episode.stepHint.readyDirect'))
      : String(t('divePipeline.episode.stepHint.motionCells'))
  }
  if (step === 'completed') return String(t('divePipeline.episode.stepHint.completed'))
  return String(t('divePipeline.episode.stepHint.default'))
})

function nodeRunStatus(key: string): GraphNodeRunState['status'] | undefined {
  const node = nodeByKey(key)
  return node ? runStates.value[node.id]?.status : undefined
}

function reviewResult(target: string): 'PASS' | 'FAIL' | '' {
  const reviewNode = nodeByKey(
    target === 'breakdown'
      ? 'review1'
      : target === 'beatboard'
        ? 'review2'
        : target === 'sequence'
          ? 'review3'
          : 'review4'
  )
  // 只读节点上的审核标记，不用 agent-state 历史（避免新工作流串到旧 FAIL/PASS）
  const direct = reviewNode?.params?.episodeReviewStatus
  if (direct === 'PASS' || direct === 'FAIL') return direct
  return ''
}

const REVIEW_NODE_KEY: Record<ReviewTarget, 'review1' | 'review2' | 'review3' | 'review4'> = {
  breakdown: 'review1',
  beatboard: 'review2',
  sequence: 'review3',
  motion: 'review4'
}

/** 只有对应阶段重新生成后，导演审核才进入待审核状态。 */
function reviewReady(target: ReviewTarget): boolean {
  const reviewNode = nodeByKey(REVIEW_NODE_KEY[target])
  return reviewNode?.params?.episodeReviewPending === true && !reviewResult(target)
}

const headerFailReason = computed(() => {
  // 优先/仅从当前图审核节点取 FAIL 原因；agent-state 是跨工作流共享的历史文件，不能驱动顶栏展示
  for (const key of ['review1', 'review2', 'review3', 'review4']) {
    const node = nodeByKey(key)
    if (node?.params?.episodeReviewStatus !== 'FAIL') continue
    const reason = String(node.params.episodeReviewReason ?? '').trim()
    if (reason) return reason
  }
  return ''
})

function anchorReviewStatus(): 'PASS' | 'FAIL' | '' {
  return reviewResult('beatboard')
}

function anchorReviewLabel(index: number): string {
  const status = anchorReviewStatus()
  if (status === 'PASS') return 'PASS'
  if (status === 'FAIL') return 'FAIL'
  const run = nodeRunStatus('review2')
  if (run === 'done') return String(t('divePipeline.episode.state.awaitReview'))
  // 审核未出结果时按本格图片是否已生成显示，避免“有图却标未生成”
  return anchorImageUrl(index)
    ? String(t('divePipeline.episode.state.generated'))
    : String(t('divePipeline.episode.state.notGenerated'))
}

function cellVideoStatusLabel(cell: EpisodeCellRow): string {
  const key = `video${cell.groupIndex}-${cell.cellIndex}`
  const status = nodeRunStatus(key)
  const path = selectedVideoRelativePath(nodeByKey(key))
  if (path) return String(t('divePipeline.episode.state.generated'))
  if (status === 'done') return String(t('divePipeline.episode.state.ranOnce'))
  if (status === 'error') return String(t('divePipeline.episode.state.failed'))
  return String(t('divePipeline.episode.state.notGenerated'))
}

function selectBeat(beat: EpisodeBeatRow): void {
  activeBeat.value = beat.index
  const anchors = anchors9.value
  const topAnchors = selectEpisodeAnchors(beats.value)
  const ordinal = topAnchors.findIndex((item) => item.index === beat.index)
  let anchor: EpisodeAnchorRow | undefined
  // 1) 新数据：9宫格按锚点序号 1~9 引用（与格号一致）
  if (ordinal >= 0) {
    anchor = anchors.find((row) => extractEpisodeBeatNumber(row.beatId) === ordinal + 1)
  }
  // 2) 旧数据：宫格引用原始节拍编号
  if (!anchor) {
    anchor = anchors.find((row) => extractEpisodeBeatNumber(row.beatId) === beat.index)
  }
  // 3) 旧数据无节拍ID：按锚点顺序对应宫格
  if (!anchor && ordinal >= 0) {
    anchor = anchors[ordinal]
  }
  if (anchor) selectedAnchorIndex.value = anchor.index
}

/** 9宫格只对应前 9 个锚点；超出部分的锚标记不再显示，避免满屏重复“锚” */
function isAnchorBeat(beat: EpisodeBeatRow): boolean {
  return selectEpisodeAnchors(beats.value).some((item) => item.index === beat.index)
}

function selectCell(cell: EpisodeCellRow): void {
  selectedCell.value = { groupIndex: cell.groupIndex, cellIndex: cell.cellIndex }
}

// 宫格切换（点击节拍联动或点击 9宫格）后，4宫格默认选中该组第一个
watch(selectedAnchorIndex, (next) => {
  selectedCell.value = { groupIndex: next, cellIndex: 1 }
})

function assetTaskTarget(): GraphTaskTarget {
  return {
    kind: 'asset',
    assetId: props.hostAssetId,
    hostId: `asset:${props.hostAssetId}`
  }
}

function enqueueNode(
  node: GraphNode | undefined,
  title: string,
  forceTargets = false,
  invalidatedNodeIds?: string[],
  logMeta?: GraphRunLogMeta
): string | null {
  return enqueueNodes(node ? [node] : [], title, forceTargets, invalidatedNodeIds, logMeta)
}

function enqueueNodes(
  targets: GraphNode[],
  title: string,
  forceTargets = false,
  invalidatedNodeIds?: string[],
  logMeta?: GraphRunLogMeta
): string | null {
  if (!targets.length || !graphDoc.value) return null
  const runHost = graphRunHosts.get(`asset:${props.hostAssetId}`)
  const priorNodeStates = { ...(runHost?.runStates ?? {}) }
  if (forceTargets) {
    // 只移除目标节点的 done 状态：目标会重跑，上游仍可复用，避免重生成整条链。
    for (const node of targets) delete priorNodeStates[node.id]
  }
  // 失效节点并入本次任务：已失效的下游即使“已完成”也不得复用旧结果
  const invalidated = invalidatedNodeIds?.length
    ? [...new Set([...staleNodeIds, ...invalidatedNodeIds])]
    : [...staleNodeIds]
  const result = taskStore.enqueueWorkflow({
    title,
    graph: graphDoc.value,
    target: assetTaskTarget(),
    targetNodeIds: targets.map((node) => node.id),
    priorNodeStates,
    skipCompletedNodes: true,
    invalidatedNodeIds: invalidated.length ? invalidated : undefined,
    logMeta
  })
  if (!result.ok) {
    void promptAlert({
      title: t('graph.tasks.duplicateTitle'),
      message: t('graph.tasks.duplicateMessage')
    })
    return null
  }
  lastPipelineRunId.value = result.id
  return result.id
}

function openPipelineLog(): void {
  if (!lastPipelineRunId.value) return
  runLogs.openDialog(lastPipelineRunId.value)
}

function openMotionNotepad(): void {
  const row = activeMotion.value
  if (!row) return
  motionNotepadCell.value = { groupIndex: row.groupIndex, cellIndex: row.cellIndex }
  motionNotepadTitle.value = `${t('graph.notepad.appMark')} · ${row.key}`
  motionNotepadText.value = row.text
  motionNotepadOpen.value = true
}

function closeMotionNotepad(): void {
  motionNotepadOpen.value = false
  motionNotepadText.value = ''
}

function patchMotionNodeText(nextFull: string): void {
  const node = nodeByKey('motion')
  if (!node) return
  const hostId = `asset:${props.hostAssetId}`
  const generated = node.params?.generatedTexts ?? []
  const selectedId = node.params?.selectedTextId?.trim()
  const generatedTexts = generated.length
    ? generated.map((item, index) => {
        const hit =
          (selectedId && item.id === selectedId) ||
          (!selectedId && index === generated.length - 1)
        return hit ? { ...item, text: nextFull } : item
      })
    : undefined
  graphEditorHosts.updateNode(hostId, node.id, {
    text: nextFull,
    ...(generatedTexts ? { generatedTexts } : {})
  })
  lastStageText.motion = nextFull
  refreshTick.value += 1
  void graphEditorHosts.flush(hostId)
}

function saveMotionNotepad(text: string): void {
  const { groupIndex, cellIndex } = motionNotepadCell.value
  const nextFull = replaceEpisodeMotionPrompt(stageText('motion'), groupIndex, cellIndex, text)
  if (nextFull == null) return
  patchMotionNodeText(nextFull)
  motionNotepadText.value = text
  invalidateReview('motion')
  invalidateDownstream('motion')
}

/** 作废旧审核；重新生成尚未产出时保持导演审核不可用。 */
function invalidateReview(target: ReviewTarget): void {
  const hostId = `asset:${props.hostAssetId}`
  const stageNode = nodeByKey(target)
  const reviewNode = nodeByKey(REVIEW_NODE_KEY[target])
  for (const node of [stageNode, reviewNode]) {
    if (!node) continue
    graphEditorHosts.updateNode(hostId, node.id, {
      episodeReviewStatus: undefined,
      episodeReviewReason: '',
      episodeReviewPending: false,
      // 重新生成时必须清掉旧审核正文，否则后台写回会再次解析旧 PASS/FAIL。
      ...(node === reviewNode ? { text: '', generatedTexts: [], selectedTextId: '' } : {})
    })
  }
  refreshTick.value += 1
  void graphEditorHosts.flush(hostId)
}

/** 生成任务成功写回后才进入待审核状态并点亮按钮。 */
function armReview(target: ReviewTarget): void {
  const hostId = `asset:${props.hostAssetId}`
  const stageNode = nodeByKey(target)
  const reviewNode = nodeByKey(REVIEW_NODE_KEY[target])
  for (const node of [stageNode, reviewNode]) {
    if (node) graphEditorHosts.updateNode(hostId, node.id, { episodeReviewPending: true })
  }
  refreshTick.value += 1
  void graphEditorHosts.flush(hostId)
}

/**
 * 阶段文本重新生成后，其全部下游产物（拼图 / 提取 / 放大 / 4宫格 / 视频 / 审核）
 * 一律视为失效：清掉展示产物与运行态，后续任何生成动作都不再复用旧结果，
 * 而是从最新文本一致地补跑整条链。
 */
function invalidateDownstream(target: ReviewTarget): void {
  const hostId = `asset:${props.hostAssetId}`
  const stage = nodeByKey(target)
  const doc = graphDoc.value
  if (!stage || !doc) return
  const ids = [...collectDownstreamNodeIds(doc, stage.id)].filter((id) => id !== stage.id)
  if (!ids.length) return

  const idSet = new Set(ids)
  const cloned = cloneGraphDocument(doc)
  cloned.runStates = { ...(cloned.runStates ?? {}) }
  for (const node of cloned.nodes) {
    if (!idSet.has(node.id)) continue
    delete cloned.runStates?.[node.id]
    const patch: Partial<GraphNodeParams> = {}
    if (Array.isArray(node.params?.generatedImages) && node.params.generatedImages.length) {
      patch.generatedImages = []
    }
    if (Array.isArray(node.params?.generatedVideos) && node.params.generatedVideos.length) {
      patch.generatedVideos = []
    }
    if (node.params?.selectedImageId) patch.selectedImageId = ''
    if (node.params?.previewDataUrl) patch.previewDataUrl = ''
    if (node.params?.previewRelativePath) patch.previewRelativePath = ''
    // 下游导演审核同样失效：旧 PASS/FAIL 不再驱动角标/顶栏
    if (node.params?.episodeReviewTarget) {
      patch.episodeReviewStatus = undefined
      patch.episodeReviewReason = ''
      patch.episodeReviewPending = false
    }
    node.params = { ...node.params, ...patch }
  }
  graphEditorHosts.applyExternalGraph(hostId, cloned)
  for (const id of ids) staleNodeIds.add(id)
  refreshTick.value += 1
  void graphEditorHosts.flush(hostId)
}

function regenerateStage(target: ReviewTarget): void {
  if (stageBusy(target)) return
  invalidateReview(target)
  // 级联失效：下游图/视频/审核不复用旧结果，后续生成自动从最新文本一致补跑
  invalidateDownstream(target)
  // “重新生成”强制执行目标节点，但继续复用其已完成上游。
  const taskId = enqueueNode(nodeByKey(target), String(t('divePipeline.episode.task.stage', { stage: target })), true, undefined, {
    pipelineStage: target
  })
  if (taskId) regenerationTasks.set(taskId, target)
}

function runReview(target: ReviewTarget): void {
  if (!reviewReady(target)) return
  const reviewNode = nodeByKey(REVIEW_NODE_KEY[target])
  if (!reviewNode) return
  // 点击后立即锁定，避免重复提交；审核结果写回时会保持 pending=false。
  const hostId = `asset:${props.hostAssetId}`
  graphEditorHosts.updateNode(hostId, reviewNode.id, { episodeReviewPending: false })
  refreshTick.value += 1
  void graphEditorHosts.flush(hostId)
  enqueueNode(
    reviewNode,
    String(t('divePipeline.episode.task.stage', { stage: REVIEW_NODE_KEY[target] })),
    true,
    undefined,
    { pipelineStage: `review.${target}` }
  )
}

function runAnchorImage(): void {
  // 一键工作流：先跑「9宫格拼图·锚点画布」生成整张 9宫格，再一次性提取全部 9 格
  const board = nodes.value.find(
    (n) => n.typeId === 'asset.image' && n.title?.includes('9宫格拼图') // cjk-ok 旧文档标题探测
  )
  const extracts = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    .map((index) => nodeByKey(`img${index}`))
    .filter((n): n is GraphNode => !!n)
  enqueueNodes(
    [board, ...extracts].filter((n): n is GraphNode => !!n),
    String(t('divePipeline.episode.action.buildGrid9')),
    false,
    undefined,
    { pipelineStage: 'image.grid9' }
  )
}

/** 生成当前组的 4宫格拼图，并提取该组 4 格作为动态视频参考图 */
function runFourGridImage(): void {
  const groupIndex = selectedAnchorIndex.value
  const board = nodes.value.find(
    (n) => n.typeId === 'asset.image' && n.title?.includes(`4宫格拼图·组${groupIndex}`) // cjk-ok 旧文档标题探测
  )
  const extracts = [1, 2, 3, 4]
    .map((cellIndex) => cellImageNode(groupIndex, cellIndex))
    .filter((n): n is GraphNode => !!n)
  enqueueNodes(
    [board, ...extracts].filter((n): n is GraphNode => !!n),
    String(t('divePipeline.episode.task.buildGrid4Group', { g: groupIndex })),
    false,
    undefined,
    { pipelineStage: 'image.grid4', cellKey: String(groupIndex) }
  )
}

function runCurrentVideo(): void {
  if (!canRunCurrentVideo.value) return
  const node = currentVideoNode()
  if (!node) return
  const { groupIndex, cellIndex } = selectedCell.value
  enqueueNode(
    node,
    String(t('divePipeline.episode.task.video', { g: groupIndex, c: cellIndex })),
    true,
    undefined,
    {
      pipelineStage: 'video',
      cellKey: `${groupIndex}-${cellIndex}`
    }
  )
}

async function fileUrl(relativePath: string | undefined): Promise<string> {
  if (!relativePath) return ''
  const cached = urlCache.get(relativePath)
  if (cached) return cached
  const url = await window.studio.getAssetFileUrl(relativePath)
  if (url) urlCache.set(relativePath, url)
  return url
}

function anchorImageUrl(index: number): string {
  const key = `anchor:${index}`
  const cached = imageUrls.value.get(key)
  if (cached) return cached
  const path = firstImageRelativePath(nodeByKey(`img${index}`))
  if (!path) return ''
  void fileUrl(path).then((url) => {
    if (!url) return
    // 值未变化时不要重建 Map，避免「渲染 → 异步写回 → 再渲染」死循环
    if (imageUrls.value.get(key) === url) return
    imageUrls.value = new Map(imageUrls.value).set(key, url)
  })
  return ''
}

/** 4宫格格图节点：来自「宫格提取·组G-格C」切分节点 */
function cellImageNode(groupIndex: number, cellIndex: number): GraphNode | undefined {
  return nodes.value.find(
    (n) =>
      n.typeId === 'image.gridSplit' &&
      typeof n.title === 'string' &&
      n.title.includes(`宫格提取·组${groupIndex}-格${cellIndex}`) // cjk-ok 旧文档标题探测
  )
}

/** 4宫格格图 URL：优先缓存，未生成时异步取文件 URL */
function cellImageUrl(groupIndex: number, cellIndex: number): string {
  const key = `cell:${groupIndex}-${cellIndex}`
  const cached = imageUrls.value.get(key)
  if (cached) return cached
  const node = cellImageNode(groupIndex, cellIndex)
  const path = firstImageRelativePath(node)
  if (!path) return ''
  void fileUrl(path).then((url) => {
    if (!url) return
    if (imageUrls.value.get(key) === url) return
    imageUrls.value = new Map(imageUrls.value).set(key, url)
  })
  return ''
}

const imageUrls = ref(new Map<string, string>())

async function loadAll(): Promise<void> {
  refreshing.value = true
  refreshTick.value += 1
  try {
    const raw = await readEpisodeAgentState(scopeKey.value)
    agentState.value = parseEpisodeAgentState(raw)
  } catch {
    agentState.value = null
  }
  imageUrls.value = new Map()
  try {
    for (const anchor of anchors9.value) {
      const path = firstImageRelativePath(nodeByKey(`img${anchor.index}`))
      if (path) {
        const url = await fileUrl(path)
        if (url) imageUrls.value.set(`anchor:${anchor.index}`, url)
      }
    }
    for (const cell of cells36.value) {
      const path = firstImageRelativePath(cellImageNode(cell.groupIndex, cell.cellIndex))
      if (path) {
        const url = await fileUrl(path)
        if (url) imageUrls.value.set(`cell:${cell.groupIndex}-${cell.cellIndex}`, url)
      }
    }
    await refreshActiveVideoUrl()
  } finally {
    refreshing.value = false
    // 已重新生成完成的失效节点移出失效集合，后续可正常复用
    if (staleNodeIds.size) {
      for (const id of [...staleNodeIds]) {
        if (runStates.value[id]?.status === 'done') staleNodeIds.delete(id)
      }
    }
  }
}

void loadAll()

// 任务队列变化后自动刷新产物与状态
watch(runningCount, async (count, prev) => {
  if (prev !== undefined && count < prev) {
    await new Promise((resolve) => setTimeout(resolve, 800))
    await loadAll()
  }
})

// 只有“重新生成”任务成功完成并写回结果，才开放对应导演审核。
watch(
  () => taskStore.completed.map((task) => `${task.id}:${task.status}`).join('|'),
  async () => {
    for (const task of taskStore.completed) {
      const target = regenerationTasks.get(task.id)
      if (!target) continue
      regenerationTasks.delete(task.id)
      if (task.status !== 'done') continue
      const stageNode = nodeByKey(target)
      if (!stageNode || task.runStates[stageNode.id]?.status !== 'done') continue
      await loadAll()
      armReview(target)
    }
  }
)
</script>

<style scoped>
.episode-pipeline-view {
  flex: 1;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--fg);
}
.pipeline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
.pipeline-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.title-text {
  font-weight: 600;
}
.fail-row {
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--danger, #c0392b) 8%, transparent);
}
.step-chip,
.fail-chip {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 6px;
}
.step-chip {
  background: var(--bg-input);
  color: var(--fg-soft);
}
.fail-chip {
  background: var(--danger, #c0392b);
  color: #fff;
  white-space: normal;
  line-height: 1.45;
  display: inline-block;
}
.ghost-button {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--fg);
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
}
.ghost-button:disabled,
.ghost-button.is-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ghost-button.primary {
  background: var(--accent, #3498db);
  border-color: var(--accent, #3498db);
  color: #fff;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.busy-chip {
  font-size: 12px;
  color: var(--accent, #3498db);
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border);
  background: var(--bg-input);
}
.panel-head h3 {
  border-bottom: none;
  background: transparent;
}
.panel-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-right: 8px;
}
.panel-actions button {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--fg);
  cursor: pointer;
}
.panel-actions button:hover {
  border-color: var(--accent, #3498db);
}
.panel-actions button:disabled {
  opacity: 0.38;
  cursor: not-allowed;
  border-color: var(--border);
}
.panel-actions .icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 24px;
  padding: 0;
}
.panel-actions .review-button.ready {
  color: #fff;
  font-weight: 600;
  background: var(--accent, #3498db);
  border-color: var(--accent, #3498db);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--accent, #3498db) 45%, transparent),
    0 0 10px color-mix(in srgb, var(--accent, #3498db) 42%, transparent);
}
.pass-mark {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  color: #fff;
  background: var(--success, #27ae60);
  vertical-align: middle;
}
.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.detail-head h4 {
  margin: 0;
}
.empty-hint,
.empty-row {
  color: var(--fg-soft);
  padding: 16px;
  font-size: 13px;
}
.pipeline-body {
  flex: 1;
  min-height: 0;
  display: grid;
  gap: 10px;
  padding: 10px;
}
.splitter {
  width: 100%;
  cursor: col-resize;
  touch-action: none;
  user-select: none;
  border-radius: 3px;
  background: transparent;
}
.splitter:hover,
.splitter.active {
  background: color-mix(in srgb, var(--accent) 32%, transparent);
}
.panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.panel h3 {
  margin: 0;
  padding: 8px 10px;
  font-size: 13px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-input);
}
.beat-list {
  flex: 1;
  overflow: auto;
  margin: 0;
  padding: 6px;
  list-style: none;
}
.beat-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  border-radius: 6px;
  cursor: pointer;
  transition:
    background 0.12s ease,
    box-shadow 0.12s ease,
    transform 0.06s ease;
}
.beat-item:hover {
  background: var(--bg-hover);
}
.beat-item.active {
  background: color-mix(in srgb, var(--accent, #3498db) 14%, var(--bg));
  box-shadow: inset 3px 0 0 var(--accent, #3498db);
}
.beat-item:active {
  transform: scale(0.98);
}
.beat-item.anchor {
  outline: 1px solid var(--accent, #3498db);
}
.beat-index {
  color: var(--fg-soft);
  font-size: 12px;
}
.beat-summary {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.beat-meta {
  display: flex;
  align-items: center;
  gap: 4px;
}
.intensity {
  font-size: 12px;
  color: var(--fg-soft);
}
.anchor-badge {
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--accent, #3498db);
  color: #fff;
}
.grid-9 {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 10px;
  overflow: auto;
}
.anchor-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-input);
  color: var(--fg);
  cursor: pointer;
  text-align: left;
  transition:
    background 0.12s ease,
    border-color 0.12s ease,
    box-shadow 0.12s ease,
    transform 0.06s ease;
}
.anchor-card:hover,
.cell-card:hover {
  border-color: var(--accent, #3498db);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent, #3498db) 35%, transparent);
}
.anchor-card:active,
.cell-card:active {
  transform: scale(0.98);
}
.anchor-card.active {
  border-color: var(--accent, #3498db);
  background: color-mix(in srgb, var(--accent, #3498db) 10%, var(--bg-input));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent, #3498db) 50%, transparent);
}
.anchor-card.pass {
  border-color: var(--success, #27ae60);
}
.anchor-card.fail {
  border-color: var(--danger, #c0392b);
}
.anchor-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
}
.beat-ref {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--bg);
  color: var(--fg-soft);
  white-space: nowrap;
}
.anchor-title {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--bg);
  color: var(--fg-soft);
}
.anchor-thumb {
  width: 100%;
  border-radius: 6px;
}
.anchor-empty {
  font-size: 11px;
  color: var(--fg-soft);
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.hint {
  margin: 0;
  padding: 6px 10px;
  font-size: 11px;
  color: var(--fg-soft);
  border-top: 1px solid var(--border);
}
.detail-panel {
  overflow: auto;
}
.breadcrumb {
  font-weight: 600;
}
.detail-block {
  padding: 10px;
  border-bottom: 1px solid var(--border);
}
.detail-block h4 {
  margin: 0 0 8px;
  font-size: 12px;
}
.grid-4 {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.cell-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-input);
  color: var(--fg);
  cursor: pointer;
  text-align: left;
  transition:
    background 0.12s ease,
    border-color 0.12s ease,
    box-shadow 0.12s ease,
    transform 0.06s ease;
}
.cell-card.active {
  border-color: var(--accent, #3498db);
  background: color-mix(in srgb, var(--accent, #3498db) 10%, var(--bg-input));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent, #3498db) 50%, transparent);
}
.cell-stage {
  font-size: 12px;
  font-weight: 600;
}
.cell-desc {
  font-size: 12px;
  color: var(--fg-soft);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.cell-thumb {
  width: 100%;
  border-radius: 6px;
  background: var(--bg);
}
.motion-text {
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  padding: 10px;
  max-height: 220px;
  overflow: auto;
  color: var(--fg);
  background: var(--bg-elevated, var(--bg));
  border: 1px solid var(--border, transparent);
  border-radius: 8px;
}
.motion-text.interactive {
  cursor: pointer;
}
.motion-text.interactive:hover {
  border-color: color-mix(in srgb, var(--accent, #6ea8fe) 45%, var(--border, currentColor));
}
.video-path {
  font-size: 12px;
  color: var(--fg-soft);
  word-break: break-all;
}
.video-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}
</style>
