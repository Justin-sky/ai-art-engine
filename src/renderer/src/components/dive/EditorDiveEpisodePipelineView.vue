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

    <div v-else class="pipeline-body">
      <!-- 左：节拍拆解表 -->
      <section class="panel beats-panel">
        <div class="panel-head">
          <h3>节拍拆解</h3>
          <div class="panel-actions">
            <button type="button" @click="runStage('breakdown')">重新生成</button>
            <button type="button" @click="runStage('review1')">导演审核</button>
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
            <span class="beat-summary">{{ beat.summary }}</span>
            <span class="beat-meta">
              <span class="intensity">{{ beat.intensity }}</span>
              <span v-if="beat.anchor" class="anchor-badge" title="关键锚点">锚</span>
            </span>
          </li>
          <li v-if="!beats.length" class="empty-row">{{ beatsEmptyLabel }}</li>
        </ul>
      </section>

      <!-- 中：9宫格 -->
      <section class="panel board-panel">
        <div class="panel-head">
          <h3>9宫格分镜表</h3>
          <div class="panel-actions">
            <button type="button" @click="runAnchorImage">生成9宫格拼图</button>
            <button type="button" @click="runStage('beatboard')">重新生成</button>
            <button type="button" @click="runStage('review2')">导演审核</button>
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
              <span class="status-badge">{{ anchorReviewLabel() }}</span>
            </span>
            <span class="anchor-title">{{ anchor.title }}</span>
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

      <!-- 右：Inspector 式详情 -->
      <section class="panel detail-panel">
        <div class="panel-head">
          <h3 class="breadcrumb">
            场/节拍 #{{ activeBeat }} → 格{{ selectedAnchorIndex }} → 动态格 {{ selectedCellKey }}
          </h3>
        </div>

        <div class="detail-block">
          <div class="detail-head">
            <h4>4宫格（{{ selectedAnchorIndex }}）</h4>
            <div class="panel-actions">
              <button type="button" @click="runFourGridImage">生成4宫格拼图</button>
              <button type="button" @click="runStage('sequence')">重新生成</button>
              <button type="button" @click="runStage('review3')">导演审核</button>
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
              <span class="cell-desc">{{ cell.text }}</span>
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

        <div v-if="activeMotion" class="detail-block motion-block">
          <div class="detail-head">
            <h4>动态提示词（{{ activeMotion.key }}）</h4>
            <div class="panel-actions">
              <button type="button" @click="runStage('motion')">重新生成</button>
              <button type="button" @click="runStage('review4')">导演审核</button>
            </div>
          </div>
          <pre class="motion-text">{{ activeMotion.text }}</pre>
        </div>

        <div v-if="activeCellVideo" class="detail-block video-block">
          <h4>视频产物</h4>
          <span class="video-path">{{ activeCellVideo }}</span>
          <button class="ghost-button primary" type="button" @click="runCurrentVideo">
            重新生成这条视频
          </button>
        </div>
        <div v-else class="detail-block video-block">
          <h4>视频产物</h4>
          <span class="video-path">未生成</span>
          <button class="ghost-button primary" type="button" @click="runCurrentVideo">
            生成这条视频
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { GraphDocument, GraphNode, GraphNodeRunState } from '@shared/graph'
import {
  parseEpisodeAgentState,
  parseEpisodeBeatBoard,
  parseEpisodeBeatBreakdown,
  parseEpisodeMotionPrompts,
  parseEpisodeSequenceBoard,
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
  const direct = node.params?.generatedImages?.[0]?.relativePath
  if (direct) return direct
  const out = runStates.value[node.id]?.outputs?.out
  if (out?.kind === 'image' && out.relativePath) return out.relativePath
  if (out?.kind === 'images' && out.items[0]?.relativePath) return out.items[0].relativePath
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
  const node = nodeByKey(key)
  const path = node?.params?.generatedVideos?.[0]?.relativePath
  return typeof path === 'string' ? path : ''
})

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

function anchorReviewLabel(): string {
  const status = anchorReviewStatus()
  if (status === 'PASS') return 'PASS'
  if (status === 'FAIL') return 'FAIL'
  const run = nodeRunStatus('review2')
  return run === 'done' ? '待审核' : '未生成'
}

function cellVideoStatusLabel(cell: EpisodeCellRow): string {
  const key = `video${cell.groupIndex}-${cell.cellIndex}`
  const status = nodeRunStatus(key)
  const path = nodeByKey(key)?.params?.generatedVideos?.[0]?.relativePath
  if (path) return '已生成'
  if (status === 'done') return '已运行'
  if (status === 'error') return '失败'
  return '未生成'
}

function selectBeat(beat: EpisodeBeatRow): void {
  activeBeat.value = beat.index
  const anchor = anchors9.value.find((row) => row.beatId === String(beat.index))
  if (anchor) selectedAnchorIndex.value = anchor.index
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

function enqueueNode(node: GraphNode | undefined, title: string): void {
  enqueueNodes(node ? [node] : [], title)
}

function enqueueNodes(targets: GraphNode[], title: string): void {
  if (!targets.length || !graphDoc.value) return
  const runHost = graphRunHosts.get(`asset:${props.hostAssetId}`)
  taskStore.enqueueWorkflow({
    title,
    graph: graphDoc.value,
    target: assetTaskTarget(),
    targetNodeIds: targets.map((node) => node.id),
    priorNodeStates: runHost?.runStates ?? {},
    skipCompletedNodes: true
  })
}

function runStage(
  kind: 'breakdown' | 'beatboard' | 'sequence' | 'motion' | 'review1' | 'review2' | 'review3' | 'review4'
): void {
  enqueueNode(nodeByKey(kind), `分镜流水线·${kind}`)
}

function runAnchorImage(): void {
  const index = selectedAnchorIndex.value
  // 一键工作流：先跑「9宫格拼图·锚点画布」生成整张 9宫格，再提取当前格
  const board = nodes.value.find(
    (n) => n.typeId === 'asset.image' && n.title?.includes('9宫格拼图')
  )
  const extract = nodeByKey(`img${index}`)
  enqueueNodes(
    [board, extract].filter((n): n is GraphNode => !!n),
    `生成9宫格拼图·格${index}`
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
  } finally {
    refreshing.value = false
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
  grid-template-columns: 240px 1fr 360px;
  gap: 10px;
  padding: 10px;
}
.panel {
  display: flex;
  flex-direction: column;
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
  aspect-ratio: 16/9;
  object-fit: cover;
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
  aspect-ratio: 16/9;
  object-fit: cover;
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
