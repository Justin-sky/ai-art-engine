<template>
  <div class="focus-stage-root">
    <div class="focus-stepper-bar">
      <div class="stepper-scroll">
        <button
          v-for="(step, idx) in pipelineSteps"
          :key="step.id"
          type="button"
          class="step-pill"
          :class="{
            active: activeNode?.id === step.id,
            done: step.status === 'done',
            running: step.status === 'running',
            error: step.status === 'error'
          }"
          @click="$emit('select-node', step.id)"
        >
          <span class="step-index">{{ idx + 1 }}</span>
          <img v-if="step.thumbUrl" :src="step.thumbUrl" alt="" class="step-thumb" />
          <span class="step-meta">
            <span class="step-title">{{ step.title }}</span>
            <span class="step-kind">{{ step.subtitle }}</span>
          </span>
          <span class="step-status-dot" :class="step.status" />
        </button>
      </div>
      <div class="focus-bar-actions">
        <button
          type="button"
          class="focus-action-btn poster-btn"
          :disabled="!pipelineSteps.length"
          :title="
            isZh
              ? '导出内嵌完整节点工作流的 PNG 配方海报（其他人拖入画布即可一键复刻）'
              : 'Export Recipe Poster PNG with embedded workflow graph'
          "
          @click="$emit('export-poster')"
        >
          📸 {{ isZh ? '配方海报' : 'Recipe Poster' }}
        </button>
        <button
          type="button"
          class="focus-action-btn run-btn"
          :disabled="!pipelineSteps.length || isRunning"
          @click="$emit('run-graph')"
        >
          {{
            isRunning
              ? isZh
                ? '⏳ 运行中…'
                : '⏳ Running…'
              : isZh
                ? '▶ 运行全流程'
                : '▶ Run Pipeline'
          }}
        </button>
      </div>
    </div>

    <div v-if="!activeNode" class="focus-empty-stage">
      <div class="focus-empty-card">
        <div class="focus-empty-icon">✨</div>
        <h3>{{ isZh ? '焦点创作舞台 (Studio Focus Mode)' : 'Studio Focus Stage' }}</h3>
        <p>
          {{
            isZh
              ? '告别复杂的连线迷宫！在左侧对话区输入灵感，或直接体验免 Key 6 层全息仙侠 UI 演示工程。'
              : 'Create without node clutter. Describe your idea in chat or launch the Zero-Key 6-Layer Game UI Live Demo.'
          }}
        </p>
        <div class="focus-empty-btns">
          <button type="button" class="hero-primary-btn" @click="$emit('load-demo')">
            ⚡ {{ isZh ? '一键载入仙侠 UI 全息图层演示' : 'Load 6-Layer Game UI Demo' }}
          </button>
          <button type="button" class="hero-ghost-btn" @click="$emit('switch-to-graph')">
            🕸️ {{ isZh ? '切换到节点连线模式' : 'Switch to Node Graph' }}
          </button>
        </div>
      </div>
    </div>

    <div v-else class="focus-hero-body">
      <div class="hero-viewport">
        <div v-if="activeHeroUrl" class="hero-media-frame">
          <video
            v-if="isVideoUrl(activeHeroUrl)"
            :src="activeHeroUrl"
            controls
            autoplay
            loop
            muted
            playsinline
            class="hero-media"
          />
          <img v-else :src="activeHeroUrl" :alt="activeNode.title" class="hero-media" />
          <div class="hero-floating-badges">
            <span class="hero-badge primary">{{ activeNode.title }}</span>
            <span v-if="activeLayerCount > 0" class="hero-badge cyan">
              🧊 {{ activeLayerCount }} {{ isZh ? '独立图层' : 'Layers' }}
            </span>
            <span v-if="activePsdPath" class="hero-badge psd">
              PSD {{ isZh ? '已就绪' : 'Ready' }}
            </span>
          </div>
        </div>
        <div v-else-if="activeTextPreview" class="hero-text-frame">
          <div class="hero-text-head">{{ activeNode.title }}</div>
          <pre class="hero-text-body">{{ activeTextPreview }}</pre>
        </div>
        <div v-else class="hero-placeholder-frame">
          <div class="placeholder-glyph">🎨</div>
          <h4>{{ activeNode.title }}</h4>
          <p>
            {{
              isZh
                ? '当前步骤尚未生成媒体产物，点击右上角「▶ 运行全流程」或进入精修工作台开始创作。'
                : 'No media generated for this step yet. Run the pipeline or open the workbench.'
            }}
          </p>
        </div>

        <div class="hero-dock">
          <div class="hero-dock-info">
            <span class="dock-step-title">{{ activeNode.title }}</span>
            <span v-if="activePromptSnippet" class="dock-prompt" :title="activePromptSnippet">
              {{ activePromptSnippet }}
            </span>
          </div>
          <div class="hero-dock-actions">
            <button
              v-if="activePsdPath"
              type="button"
              class="hero-psd-btn"
              @click="openDeliverablePath(activePsdPath)"
            >
              🎨 {{ isZh ? '打开分层 PSD' : 'Open Layered PSD' }}
            </button>
            <button type="button" class="hero-dive-btn" @click="$emit('dive-node', activeNode.id)">
              🛠️ {{ isZh ? '进入精修工作台' : 'Open Dive Workbench' }}
            </button>
            <button type="button" class="hero-ghost-btn" @click="$emit('switch-to-graph')">
              🕸️ {{ isZh ? '查看节点图' : 'Node Graph' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  readImageLayerSplitFromNode,
  topologicalSort,
  type GraphDocument,
  type GraphNode
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'

const props = defineProps<{
  graph: GraphDocument
  selectedNodeId: string
  previewUrls: Record<string, string>
  isRunning: boolean
}>()

defineEmits<{
  'select-node': [nodeId: string]
  'dive-node': [nodeId: string]
  'run-graph': []
  'export-poster': []
  'switch-to-graph': []
  'load-demo': []
}>()

const { locale } = useStudioI18n()
const isZh = computed(() =>
  String(locale.value || '')
    .toLowerCase()
    .startsWith('zh')
)

const orderedNodes = computed<GraphNode[]>(() => {
  const byId = new Map(props.graph.nodes.map((n) => [n.id, n]))
  const sortedIds =
    topologicalSort(
      props.graph.nodes.map((n) => n.id),
      props.graph.edges
    ) ?? props.graph.nodes.map((n) => n.id)
  const ordered = sortedIds.map((id) => byId.get(id)).filter((n): n is GraphNode => Boolean(n))
  const nonSticky = ordered.filter((node) => node.typeId !== 'util.stickyNote')
  return nonSticky.length ? nonSticky : ordered
})

function resolveNodeThumb(node: GraphNode): string {
  const direct = props.previewUrls[node.id]
  if (direct) return direct
  if (typeof node.params?.previewDataUrl === 'string' && node.params.previewDataUrl) {
    return node.params.previewDataUrl
  }
  const imgs = Array.isArray(node.params?.generatedImages) ? node.params.generatedImages : []
  for (const item of imgs) {
    if (typeof item?.dataUrl === 'string' && item.dataUrl.startsWith('data:')) {
      return item.dataUrl
    }
  }
  return ''
}

function resolveNodeSubtitle(node: GraphNode): string {
  if (node.typeId === 'image.layerSplit')
    return isZh.value ? 'UI 图层分离 · PSD' : 'UI Layer Split · PSD'
  if (node.typeId === 'image.upscale') return isZh.value ? '超清放大' : 'HD Upscale'
  if (node.typeId === 'image.lighting') return isZh.value ? '3D 重打光' : '3D Relight'
  if (node.typeId === 'image.multiAngle') return isZh.value ? '多机位视角' : 'Multi-Angle'
  if (node.typeId === 'asset.image' || node.typeId === 'image.generate') {
    return isZh.value ? 'AI 画面生成' : 'Image Generate'
  }
  if (node.typeId === 'asset.video' || node.typeId === 'video.generate') {
    return isZh.value ? 'AI 视频生成' : 'Video Generate'
  }
  if (node.typeId === 'script.timeline') return isZh.value ? '多轨时间线剪辑' : 'Timeline Edit'
  return node.typeId || 'Node'
}

const pipelineSteps = computed(() =>
  orderedNodes.value.map((node) => ({
    id: node.id,
    title: node.title || node.typeId || 'Node',
    subtitle: resolveNodeSubtitle(node),
    status: props.graph.runStates?.[node.id]?.status || 'idle',
    thumbUrl: resolveNodeThumb(node)
  }))
)

const activeNode = computed<GraphNode | null>(() => {
  if (!orderedNodes.value.length) return null
  if (props.selectedNodeId) {
    const found = orderedNodes.value.find((n) => n.id === props.selectedNodeId)
    if (found) return found
  }
  for (let i = orderedNodes.value.length - 1; i >= 0; i -= 1) {
    const candidate = orderedNodes.value[i]!
    if (resolveNodeThumb(candidate)) return candidate
  }
  return orderedNodes.value[orderedNodes.value.length - 1] ?? null
})

const activeHeroUrl = computed(() => (activeNode.value ? resolveNodeThumb(activeNode.value) : ''))

const activeLayerCount = computed(() => {
  const node = activeNode.value
  if (!node || node.typeId !== 'image.layerSplit') return 0
  const state = readImageLayerSplitFromNode(node.params)
  return state.layers.length
})

const activePsdPath = computed(() => {
  const node = activeNode.value
  if (!node) return ''
  return typeof node.params?.layerSplitPsdRelativePath === 'string'
    ? node.params.layerSplitPsdRelativePath.trim()
    : ''
})

const activePromptSnippet = computed(() => {
  const node = activeNode.value
  if (!node) return ''
  const prompt =
    (typeof node.params?.generateInstruction === 'string' &&
      node.params.generateInstruction.trim()) ||
    (typeof node.params?.text === 'string' && node.params.text.trim()) ||
    ''
  return prompt.length > 96 ? `${prompt.slice(0, 94)}…` : prompt
})

const activeTextPreview = computed(() => {
  const node = activeNode.value
  if (!node) return ''
  const text =
    (typeof node.params?.text === 'string' && node.params.text.trim()) ||
    (typeof node.params?.generateInstruction === 'string' &&
      node.params.generateInstruction.trim()) ||
    ''
  return text
})

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url) || url.startsWith('data:video/')
}

function openDeliverablePath(relativePath: string): void {
  if (!relativePath) return
  void window.studio?.openAssetWithDefaultApp?.(relativePath)
}
</script>

<style scoped>
.focus-stage-root {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: radial-gradient(circle at 50% 35%, rgba(30, 41, 59, 0.72), rgba(9, 13, 22, 0.96));
  color: var(--text);
  overflow: hidden;
}

.focus-stepper-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
  background: rgba(15, 23, 42, 0.78);
  backdrop-filter: blur(12px);
}

.stepper-scroll {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  min-width: 0;
  flex: 1 1 auto;
  padding-bottom: 2px;
}

.step-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 11px;
  border-radius: 11px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(30, 41, 59, 0.65);
  color: var(--text);
  cursor: pointer;
  flex: 0 0 auto;
  transition:
    border-color 0.16s ease,
    background 0.16s ease,
    transform 0.12s ease;
}

.step-pill:hover {
  border-color: rgba(56, 189, 248, 0.55);
  transform: translateY(-1px);
}

.step-pill.active {
  border-color: #38bdf8;
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.22), rgba(245, 158, 11, 0.14));
  box-shadow: 0 4px 14px rgba(56, 189, 248, 0.18);
}

.step-index {
  width: 20px;
  height: 20px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  background: rgba(148, 163, 184, 0.22);
  color: #e2e8f0;
}

.step-pill.active .step-index {
  background: #38bdf8;
  color: #090d16;
}

.step-thumb {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  object-fit: cover;
  border: 1px solid rgba(148, 163, 184, 0.28);
}

.step-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
}

.step-title {
  font-size: 12px;
  font-weight: 600;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step-kind {
  font-size: 10px;
  color: var(--text-muted);
}

.step-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.45);
}

.step-status-dot.done {
  background: #34d399;
}

.step-status-dot.running {
  background: #fbbf24;
  box-shadow: 0 0 8px #fbbf24;
}

.step-status-dot.error {
  background: #f87171;
}

.focus-bar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.focus-action-btn {
  padding: 6px 12px;
  border-radius: 9px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: rgba(30, 41, 59, 0.8);
  color: #e2e8f0;
}

.focus-action-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.focus-action-btn.poster-btn:hover:not(:disabled) {
  border-color: #f59e0b;
  color: #fde68a;
}

.focus-action-btn.run-btn {
  border-color: rgba(52, 211, 153, 0.5);
  background: rgba(16, 185, 129, 0.2);
  color: #a7f3d0;
}

.focus-empty-stage {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.focus-empty-card {
  max-width: 460px;
  padding: 28px;
  border-radius: 18px;
  border: 1px solid rgba(56, 189, 248, 0.25);
  background: rgba(15, 23, 42, 0.82);
  text-align: center;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
}

.focus-empty-icon {
  font-size: 32px;
  margin-bottom: 8px;
}

.focus-empty-card h3 {
  margin: 0 0 8px;
  font-size: 16px;
}

.focus-empty-card p {
  margin: 0 0 18px;
  font-size: 12.5px;
  color: var(--text-muted);
  line-height: 1.55;
}

.focus-empty-btns {
  display: flex;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
}

.focus-hero-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  padding: 18px 24px;
}

.hero-viewport {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.hero-media-frame {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(9, 13, 22, 0.72);
  overflow: hidden;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.55);
}

.hero-media {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 8px;
}

.hero-floating-badges {
  position: absolute;
  left: 14px;
  top: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.hero-badge {
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  backdrop-filter: blur(8px);
}

.hero-badge.primary {
  background: rgba(15, 23, 42, 0.85);
  border: 1px solid rgba(148, 163, 184, 0.35);
  color: #f8fafc;
}

.hero-badge.cyan {
  background: rgba(14, 116, 144, 0.85);
  border: 1px solid rgba(56, 189, 248, 0.6);
  color: #e0f2fe;
}

.hero-badge.psd {
  background: rgba(30, 58, 138, 0.88);
  border: 1px solid #60a5fa;
  color: #dbeafe;
}

.hero-text-frame,
.hero-placeholder-frame {
  flex: 1 1 auto;
  min-height: 0;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(15, 23, 42, 0.75);
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  overflow: auto;
}

.hero-text-head {
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 10px;
}

.hero-text-body {
  max-width: 720px;
  white-space: pre-wrap;
  text-align: left;
  font-size: 12.5px;
  line-height: 1.6;
  color: #cbd5e1;
}

.placeholder-glyph {
  font-size: 36px;
  margin-bottom: 6px;
}

.hero-dock {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 16px;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(15, 23, 42, 0.86);
  backdrop-filter: blur(12px);
}

.hero-dock-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.dock-step-title {
  font-size: 13px;
  font-weight: 700;
  color: #f8fafc;
}

.dock-prompt {
  font-size: 11.5px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hero-dock-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.hero-primary-btn,
.hero-dive-btn {
  padding: 7px 14px;
  border-radius: 9px;
  border: 1px solid rgba(56, 189, 248, 0.6);
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.28), rgba(245, 158, 11, 0.22));
  color: #f0f9ff;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.hero-psd-btn {
  padding: 7px 12px;
  border-radius: 9px;
  border: 1px solid #3b82f6;
  background: rgba(37, 99, 235, 0.25);
  color: #bfdbfe;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.hero-ghost-btn {
  padding: 7px 12px;
  border-radius: 9px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: rgba(30, 41, 59, 0.7);
  color: #cbd5e1;
  font-size: 12px;
  cursor: pointer;
}
</style>
