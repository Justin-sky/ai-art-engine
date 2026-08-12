<template>
  <div class="episode-pipeline-view">
    <div class="pipeline-header">
      <div class="pipeline-title">
        <span class="title-text">{{ assetTitle }}</span>
        <span class="step-chip" :title="stateStepTitle">当前步骤：{{ stateStepLabel }}</span>
      </div>
      <div class="header-actions">
        <span v-if="runningCount" class="busy-chip">任务运行中…</span>
        <button class="ghost-button" type="button" :disabled="refreshing" @click="loadAll">
          {{ refreshing ? '刷新中…' : '刷新' }}
        </button>
      </div>
    </div>

    <div v-if="headerFailReason" class="fail-row">
      <span class="fail-chip" title="最近一次导演审核失败原因">
        FAIL：{{ headerFailReason }}
      </span>
    </div>

    <div v-if="!graphDoc" class="empty-hint">
      尚未找到工作流数据。请先运行一次「分镜师·节拍拆解表」节点，再点击顶部工具栏的「剧集流水线」打开本视图。
    </div>

    <div v-else class="pipeline-body" :style="pipelineBodyStyle">
      <!-- 左：节拍拆解表 -->
      <section class="panel beats-panel">
        <div class="panel-head">
          <h3>
            节拍拆解
            <span v-if="reviewResult('breakdown') === 'PASS'" class="pass-mark">✓ 已通过</span>
          </h3>
          <div class="panel-actions">
            <button type="button" @click="regenerateStage('breakdown')">重新生成</button>
            <button
              type="button"
              class="review-button"
              :class="{ ready: reviewReady('breakdown') }"
              :disabled="!reviewReady('breakdown')"
              @click="runReview('breakdown')"
            >
              导演审核
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
            <OverflowTip class="beat-summary" :text="beat.summary">{{ beat.summary }}</OverflowTip>
            <span class="beat-meta">
              <span class="intensity">{{ beat.intensity }}</span>
              <span v-if="isAnchorBeat(beat)" class="anchor-badge" title="关键锚点（9宫格对应前 9 个锚）">锚</span>
            </span>
          </li>
          <li v-if="!beats.length" class="empty-row">{{ beatsEmptyLabel }}</li>
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
            9宫格分镜表
            <span v-if="reviewResult('beatboard') === 'PASS'" class="pass-mark">✓ 已通过</span>
          </h3>
          <div class="panel-actions">
            <button type="button" @click="regenerateStage('beatboard')">重新生成</button>
            <button
              type="button"
              class="review-button"
              :class="{ ready: reviewReady('beatboard') }"
              :disabled="!reviewReady('beatboard')"
              @click="runReview('beatboard')"
            >
              导演审核
            </button>
            <button
              type="button"
              class="icon-button"
              title="生成9宫格拼图"
              @click="runAnchorImage"
            >
              <GridIcon :rows="3" :cols="3" />
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
              <b>格{{ anchor.index }}</b>
              <span v-if="anchor.beatId" class="beat-ref" title="关联节拍">节拍{{ anchor.beatId }}</span>
              <span class="status-badge">{{ anchorReviewLabel(anchor.index) }}</span>
            </span>
            <OverflowTip class="anchor-title" :text="anchor.title">{{ anchor.title }}</OverflowTip>
            <img
              v-if="anchorImageUrl(anchor.index)"
              :src="anchorImageUrl(anchor.index)"
              class="anchor-thumb"
              alt=""
            />
            <span v-else class="anchor-empty">未生成图</span>
          </button>
          <div v-if="!anchors9.length" class="empty-row">{{ anchorsEmptyLabel }}</div>
        </div>
        <p v-if="anchors9.length" class="hint">
          顶部工具栏的「剧集流水线」按钮可随时回到本视图；图片/视频在节点图中运行。
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
            场/节拍 #{{ activeBeat }} → 格{{ selectedAnchorIndex }} → 动态格 {{ selectedCellKey }}
          </h3>
        </div>

        <div class="detail-block">
          <div class="detail-head">
            <h4>
              4宫格（{{ selectedAnchorIndex }}）
              <span v-if="reviewResult('sequence') === 'PASS'" class="pass-mark">✓ 已通过</span>
            </h4>
            <div class="panel-actions">
              <button type="button" @click="regenerateStage('sequence')">重新生成</button>
              <button
                type="button"
                class="review-button"
                :class="{ ready: reviewReady('sequence') }"
                :disabled="!reviewReady('sequence')"
                @click="runReview('sequence')"
              >
                导演审核
              </button>
              <button
                type="button"
                class="icon-button"
                title="生成4宫格拼图"
                @click="runFourGridImage"
              >
                <GridIcon :rows="2" :cols="2" />
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
              <OverflowTip class="cell-desc" :text="cell.text">{{ cell.text }}</OverflowTip>
              <img
                v-if="cellImageUrl(cell.groupIndex, cell.cellIndex)"
                :src="cellImageUrl(cell.groupIndex, cell.cellIndex)"
                class="cell-thumb"
                alt=""
              />
              <span class="status-badge">{{ cellVideoStatusLabel(cell) }}</span>
            </button>
            <div v-if="!anchorCells.length" class="empty-row">{{ cellsEmptyLabel }}</div>
          </div>
        </div>

        <div v-if="activeCellVideo" class="detail-block video-block">
          <h4>视频产物</h4>
          <MediaPreviewPlayer v-if="activeVideoUrl" kind="video" :src="activeVideoUrl" />
          <OverflowTip class="video-path" :text="activeCellVideo">{{ activeCellVideo }}</OverflowTip>
          <button
            class="ghost-button primary"
            type="button"
            :disabled="currentCellVideoRunning"
            @click="runCurrentVideo"
          >
            {{ currentCellVideoRunning ? '生成中…' : '重新生成这条视频' }}
          </button>
        </div>
        <div v-else class="detail-block video-block">
          <h4>视频产物</h4>
          <span class="video-path">未生成</span>
          <button
            class="ghost-button primary"
            type="button"
            :disabled="currentCellVideoRunning"
            @click="runCurrentVideo"
          >
            {{ currentCellVideoRunning ? '生成中…' : '生成这条视频' }}
          </button>
        </div>

        <div v-if="activeMotion" class="detail-block motion-block">
          <div class="detail-head">
            <h4>
              动态提示词（{{ activeMotion.key }}）
              <span v-if="reviewResult('motion') === 'PASS'" class="pass-mark">✓ 已通过</span>
            </h4>
            <div class="panel-actions">
              <button type="button" @click="regenerateStage('motion')">重新生成</button>
              <button
                type="button"
                class="review-button"
                :class="{ ready: reviewReady('motion') }"
                :disabled="!reviewReady('motion')"
                @click="runReview('motion')"
              >
                导演审核
              </button>
            </div>
          </div>
          <pre class="motion-text">{{ activeMotion.text }}</pre>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  GraphDocument,
  GraphNode,
  GraphNodeParams,
  GraphNodeRunState
} from '@shared/graph'
import OverflowTip from '../OverflowTip.vue'
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
  selectEpisodeAnchors,
  type EpisodeAgentState,
  type EpisodeAnchorRow,
  type EpisodeBeatRow,
  type EpisodeCellRow,
  type EpisodeMotionRow
} from '@shared/graph'
import { readEpisodeAgentState } from '../../features/graph/episodeAgentStateIO'
import { graphEditorHosts } from '../../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../../features/graph/model/graphRunHosts'
import { useProjectStore } from '../../stores/project'
import { useGraphTaskStore, type GraphTaskTarget } from '../../stores/graphTasks'

const props = defineProps<{
  frameKey: string
  hostAssetId: string
}>()

const project = useProjectStore()
const taskStore = useGraphTaskStore()
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
const assetTitle = computed(() => asset.value?.name ?? '剧集分镜流水线')

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

/** 阶段生成节点：优先按 episodeStep 参数匹配，其次按标题兜底（手动创建时可能没带参数） */
function findStageNode(step: string, titleHint: string): GraphNode | undefined {
  const all = nodes.value
  return (
    all.find((n) => n.typeId === 'prompt.optimize' && n.params?.episodeStep === step) ??
    all.find(
      (n) =>
        n.typeId === 'prompt.optimize' &&
        typeof n.title === 'string' &&
        n.title.includes(titleHint)
    )
  )
}

/** 导演审核节点：优先按 episodeReviewTarget 匹配，其次按「审核 + 阶段名」标题兜底 */
function findReviewNode(target: string, titleHint: string): GraphNode | undefined {
  const all = nodes.value
  return (
    all.find(
      (n) => n.typeId === 'prompt.optimize' && n.params?.episodeReviewTarget === target
    ) ??
    all.find(
      (n) =>
        n.typeId === 'prompt.optimize' &&
        typeof n.title === 'string' &&
        n.title.includes('审核') &&
        n.title.includes(titleHint)
    )
  )
}

function findEpisodeNode(kind: string): GraphNode | undefined {
  if (kind === 'breakdown') {
    return findStageNode('breakdown', '节拍拆解')
  }
  if (kind === 'beatboard') {
    return findStageNode('beatboard', '9宫格')
  }
  if (kind === 'sequence') {
    return findStageNode('sequence', '4宫格')
  }
  if (kind === 'motion') {
    return findStageNode('motion', '动态提示词')
  }
  if (kind === 'review2') {
    return findReviewNode('beatboard', '9宫格')
  }
  if (kind === 'review1') {
    return findReviewNode('breakdown', '节拍拆解')
  }
  if (kind === 'review3') {
    return findReviewNode('sequence', '4宫格')
  }
  if (kind === 'review4') {
    return findReviewNode('motion', '动态提示词')
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
    // 一键工作流：格图由「宫格提取·格N」（image.gridSplit 纯切分）产出
    const gridSplit = nodes.value.find(
      (n) =>
        n.typeId === 'image.gridSplit' &&
        typeof n.title === 'string' &&
        n.title.includes(`宫格提取·格${index}`)
    )
    const candidates = [
      gridSplit,
      nodes.value.find(
        (n) =>
          n.typeId === 'asset.image' &&
          n.title?.includes(`锚点图·格${index}`)
      ),
      nodes.value.find(
        (n) =>
          n.typeId === 'asset.image' &&
          typeof n.params?.generateInstruction === 'string' &&
          (n.params.generateInstruction as string).includes(`格${index} 的锚点分镜图`)
      )
    ].filter((n): n is GraphNode => !!n)
    // 优先返回已生成图片的节点；都没有时按顺序取第一个（用于显示“未生成图”）
    return candidates.find((n) => firstImageRelativePath(n)) ?? candidates[0]
  }
  const videoMatch = /^video(\d+)-(\d+)$/.exec(kind)
  if (videoMatch) {
    const g = Number(videoMatch[1])
    const c = Number(videoMatch[2])
    return (
      nodes.value.find(
        (n) =>
          n.typeId === 'asset.video' &&
          n.title?.includes(`格${g}-${c}`)
      ) ??
      nodes.value.find(
        (n) =>
          n.typeId === 'asset.video' &&
          typeof n.params?.generateInstruction === 'string' &&
          (n.params.generateInstruction as string).includes(`格${g}-${c} 的动态视频`)
      )
    )
  }
  return undefined
}

function nodeText(key: string): string {
  const node = nodeByKey(key)
  if (!node) return ''
  const text = node.params?.text?.trim()
  if (text) return text
  const out = runStates.value[node.id]?.outputs?.out
  if (out && 'text' in out && typeof out.text === 'string') return out.text
  return ''
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

const beats = computed<EpisodeBeatRow[]>(() => parseEpisodeBeatBreakdown(nodeText('breakdown')))
const anchors9 = computed<EpisodeAnchorRow[]>(() => parseEpisodeBeatBoard(nodeText('beatboard')))
const cells36 = computed<EpisodeCellRow[]>(() => parseEpisodeSequenceBoard(nodeText('sequence')))
const motions36 = computed<EpisodeMotionRow[]>(() => parseEpisodeMotionPrompts(nodeText('motion')))

const anchorCells = computed<EpisodeCellRow[]>(() =>
  cells36.value.filter((cell) => cell.groupIndex === selectedAnchorIndex.value)
)

const beatsEmptyLabel = computed(() =>
  nodeText('breakdown').trim()
    ? '节拍拆解有内容，但未能解析为表格格式'
    : '未生成（运行 breakdown 节点）'
)
const anchorsEmptyLabel = computed(() =>
  nodeText('beatboard').trim()
    ? '9宫格有内容，但未能解析'
    : '未生成（运行 beatboard 节点）'
)
const cellsEmptyLabel = computed(() =>
  nodeText('sequence').trim()
    ? '4宫格有内容，但未能解析'
    : '未生成（运行 sequence 节点）'
)

const selectedCellKey = computed(
  () => `格${selectedCell.value.groupIndex}-${selectedCell.value.cellIndex}`
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

/** 当前选中格的视频是否正在生成（按钮显示“生成中…”并禁用，避免重复点击被静默吞掉） */
const currentCellVideoRunning = computed(() => {
  const status = nodeRunStatus(
    `video${selectedCell.value.groupIndex}-${selectedCell.value.cellIndex}`
  )
  return status === 'pending' || status === 'running'
})

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
  const map: Record<string, string> = {
    breakdown: '节拍拆解表',
    beatboard: '9宫格分镜表',
    sequence: '4宫格动态分镜表',
    motion: '动态提示词表',
    completed: '已完成'
  }
  return map[agentState.value?.current_step ?? ''] ?? '—'
})

/** 当前步骤的悬停说明：流水线推进到的阶段 */
const stateStepTitle = computed(() => {
  const step = agentState.value?.current_step
  const hints: Record<string, string> = {
    breakdown: '节拍拆解表已生成，正在推进 9宫格分镜表',
    beatboard: '9宫格分镜表已生成，正在推进 4宫格动态分镜表',
    sequence: '4宫格动态分镜表已生成，正在推进 动态提示词表',
    motion: '动态提示词表已生成，等待导演审核通过后完成',
    completed: '全部阶段已通过'
  }
  return hints[step ?? ''] ?? '流水线当前推进到的阶段'
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

type ReviewTarget = 'breakdown' | 'beatboard' | 'sequence' | 'motion'

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
  if (run === 'done') return '待审核'
  // 审核未出结果时按本格图片是否已生成显示，避免“有图却标未生成”
  return anchorImageUrl(index) ? '已生成' : '未生成'
}

function cellVideoStatusLabel(cell: EpisodeCellRow): string {
  const key = `video${cell.groupIndex}-${cell.cellIndex}`
  const status = nodeRunStatus(key)
  const path = selectedVideoRelativePath(nodeByKey(key))
  if (path) return '已生成'
  if (status === 'done') return '已运行'
  if (status === 'error') return '失败'
  return '未生成'
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
  invalidatedNodeIds?: string[]
): string | null {
  return enqueueNodes(node ? [node] : [], title, forceTargets, invalidatedNodeIds)
}

function enqueueNodes(
  targets: GraphNode[],
  title: string,
  forceTargets = false,
  invalidatedNodeIds?: string[]
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
    invalidatedNodeIds: invalidated.length ? invalidated : undefined
  })
  return result.ok ? result.id : null
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
  invalidateReview(target)
  // 级联失效：下游图/视频/审核不复用旧结果，后续生成自动从最新文本一致补跑
  invalidateDownstream(target)
  // “重新生成”强制执行目标节点，但继续复用其已完成上游。
  const taskId = enqueueNode(nodeByKey(target), `分镜流水线·${target}`, true)
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
  enqueueNode(reviewNode, `分镜流水线·${REVIEW_NODE_KEY[target]}`, true)
}

function runAnchorImage(): void {
  // 一键工作流：先跑「9宫格拼图·锚点画布」生成整张 9宫格，再一次性提取全部 9 格
  const board = nodes.value.find(
    (n) => n.typeId === 'asset.image' && n.title?.includes('9宫格拼图')
  )
  const extracts = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    .map((index) => nodeByKey(`img${index}`))
    .filter((n): n is GraphNode => !!n)
  enqueueNodes(
    [board, ...extracts].filter((n): n is GraphNode => !!n),
    '生成9宫格拼图'
  )
}

/** 生成当前组的 4宫格拼图，并提取该组 4 格作为动态视频参考图 */
function runFourGridImage(): void {
  const groupIndex = selectedAnchorIndex.value
  const board = nodes.value.find(
    (n) => n.typeId === 'asset.image' && n.title?.includes(`4宫格拼图·组${groupIndex}`)
  )
  const extracts = [1, 2, 3, 4]
    .map((cellIndex) => cellImageNode(groupIndex, cellIndex))
    .filter((n): n is GraphNode => !!n)
  enqueueNodes(
    [board, ...extracts].filter((n): n is GraphNode => !!n),
    `生成4宫格拼图·组${groupIndex}`
  )
}

function runCurrentVideo(): void {
  const { groupIndex, cellIndex } = selectedCell.value
  enqueueNode(nodeByKey(`video${groupIndex}-${cellIndex}`), `动态视频·格${groupIndex}-${cellIndex}`)
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
      n.title.includes(`宫格提取·组${groupIndex}-格${cellIndex}`)
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
.ghost-button:disabled {
  opacity: 0.5;
  cursor: default;
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
  color: var(--fg);
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
