<template>
  <div class="comic-page-wrap" :class="{ 'comic-page-wrap--editable': editable }">
    <div v-if="exportable && !editable" class="head">
      <button
        type="button"
        class="export-btn"
        :disabled="exporting || norm.panels.length === 0"
        @click="exportPng"
      >
        {{
          exporting
            ? t('graph.inspector.comicPage.exporting')
            : t('graph.inspector.comicPage.exportPng')
        }}
      </button>
      <span v-if="exportMessage" class="export-msg" :class="{ 'export-msg--error': exportFailed }">
        {{ exportMessage }}
      </span>
    </div>

    <!-- 全屏 Dive 视口容器：支持缩放、空格平移、自适应居中；非编辑态则保持紧凑等比卡片 -->
    <div
      ref="viewportEl"
      class="comic-viewport"
      :class="{
        'comic-viewport--studio': editable,
        'comic-viewport--panning': isSpacePressed || drag?.kind === 'viewport-pan'
      }"
      @wheel="onViewportWheel"
      @pointerdown="onViewportPointerDown"
    >
      <!-- 视口左上角状态提示 / 构图模式横幅 -->
      <div v-if="editable && framingPanel" class="framing-banner" @pointerdown.stop>
        <span class="framing-dot" />
        <span>
          {{ uiLabels.framingBanner }}
        </span>
        <button type="button" class="framing-btn" @click="resetPanelFraming(framingPanel.id)">
          {{ pickComicBi('重置构图', 'Reset Framing') }}
        </button>
        <button
          type="button"
          class="framing-btn framing-btn--primary"
          @click="framingPanelId = null"
        >
          {{ pickComicBi('完成取景', 'Done') }}
        </button>
      </div>

      <!-- 视口右下角缩放控制栏 -->
      <div v-if="editable" class="zoom-bar" @pointerdown.stop>
        <button
          type="button"
          class="zoom-btn"
          :title="pickComicBi('缩小视口', 'Zoom Out')"
          @click="stepZoom(-0.15)"
        >
          −
        </button>
        <button
          type="button"
          class="zoom-readout"
          :title="pickComicBi('点击重置 100%', 'Click for 100%')"
          @click="setZoom100"
        >
          {{ Math.round(viewScale * 100) }}%
        </button>
        <button
          type="button"
          class="zoom-btn"
          :title="pickComicBi('放大视口', 'Zoom In')"
          @click="stepZoom(0.15)"
        >
          +
        </button>
        <button
          type="button"
          class="zoom-btn zoom-btn--fit"
          :title="pickComicBi('适应窗口大小', 'Fit to Viewport')"
          @click="fitToViewport"
        >
          {{ pickComicBi('适应', 'Fit') }}
        </button>
        <button
          type="button"
          class="zoom-btn"
          :class="{ 'zoom-btn--active': showGridGuides }"
          :title="pickComicBi('切换网格辅助线', 'Toggle Grid Guides')"
          @click="showGridGuides = !showGridGuides"
        >
          #
        </button>
      </div>

      <div
        ref="pageEl"
        class="comic-page"
        :class="{
          'comic-page--empty': !editable && norm.panels.length === 0,
          'comic-page--editable': editable,
          'comic-page--transparent': !norm.backgroundColor?.trim()
        }"
        :style="pageStageStyle"
        @pointerdown="onPagePointerDown"
        @pointermove="onPagePointerMove"
        @pointerup="onPagePointerUp"
        @pointercancel="onPagePointerUp"
        @dblclick="onPageDoubleClick"
        @dragenter="onPageDragEnter"
        @dragover="onPageDragOver"
        @dragleave="onPageDragLeave"
        @drop="onPageDrop"
      >
        <!-- 底层 100% 所见即所得 Canvas：实时渲染斜切分镜、构图裁切、漫画速度线/集中线、6类矢量气泡与竖排文字 -->
        <canvas ref="renderCanvasEl" class="comic-render-canvas" />

        <!-- 网格辅助线与空白格点击建格引导（仅编辑态开启） -->
        <template v-if="editable && showGridGuides">
          <div
            v-for="cell in gridCells"
            :key="`cell-${cell.row}-${cell.col}`"
            class="grid-cell"
            :class="{
              'grid-cell--occupied': cell.occupied,
              'grid-cell--selected':
                selectedCell?.row === cell.row && selectedCell?.col === cell.col,
              'grid-cell--drag-over': editable && dragOverKey === `cell:${cell.row},${cell.col}`
            }"
            :style="cellStyle(cell)"
          >
            <button
              v-if="!cell.occupied"
              type="button"
              class="cell-add-btn"
              :title="pickComicBi('在此处新建分镜格', 'Create panel here')"
              @pointerdown.stop
              @click.stop="emit('quick-add-panel', cell.row, cell.col)"
            >
              +
            </button>
          </div>
        </template>

        <!-- SVG 矢量交互叠加层：展示斜切多边形高亮框、气泡尾巴指向虚线 -->
        <svg
          v-if="editable"
          class="comic-overlay-svg"
          :viewBox="`0 0 ${norm.width} ${norm.height}`"
          preserveAspectRatio="none"
        >
          <!-- 拖拽换位/拖入资产时的目标分镜高亮 -->
          <polygon
            v-if="dragOverPanelPolygon"
            :points="dragOverPanelPolygon"
            class="svg-panel-drop-highlight"
          />
          <!-- 选中分镜格的精确多边形边框（支持斜切四边形） -->
          <polygon
            v-if="selectedPanelPolygon && !selectedBubbleId"
            :points="selectedPanelPolygon"
            class="svg-panel-selected"
            :class="{ 'svg-panel-selected--framing': framingPanelId === selectedPanelId }"
          />
          <!-- 选中气泡的锚点到尾巴尖端辅助连线 -->
          <line
            v-if="selectedBubbleBounds && selectedBubbleBounds.hasTail"
            :x1="selectedBubbleBounds.anchorX"
            :y1="selectedBubbleBounds.anchorY"
            :x2="selectedBubbleBounds.tailTipX"
            :y2="selectedBubbleBounds.tailTipY"
            class="svg-tail-guide"
          />
        </svg>

        <!-- 分镜格交互热区与手柄 -->
        <template v-if="editable && norm.panels.length">
          <div
            v-for="(panel, pIdx) in orderedPanels"
            :key="panel.id"
            class="panel-hit"
            :class="{
              'panel-hit--selected': selectedPanelId === panel.id && !selectedBubbleId,
              'panel-hit--framing': framingPanelId === panel.id
            }"
            :style="[panelStyle(panel), panelResizeOverlay(panel)]"
          >
            <!-- 分镜格阅读序号角标 -->
            <span class="panel-order-badge" :title="panel.id">
              {{ pIdx + 1 }}
            </span>

            <!-- 空分镜格引导提示 -->
            <div v-if="!panel.imageUrl" class="panel-empty-guide">
              <span class="panel-empty-title">
                {{ panel.title || pickComicBi(`分镜 #${pIdx + 1}`, `Panel #${pIdx + 1}`) }}
              </span>
              <span class="panel-empty-sub">
                {{ pickComicBi('拖入图片 / 在侧栏选图', 'Drop image or pick from sidebar') }}
              </span>
            </div>

            <!-- 选中分镜格时的悬浮快捷工具条 -->
            <div
              v-if="selectedPanelId === panel.id && !selectedBubbleId && !drag"
              class="panel-floating-bar"
              @pointerdown.stop
            >
              <button
                v-if="panel.imageUrl"
                type="button"
                class="pf-btn"
                :class="{ 'pf-btn--active': framingPanelId === panel.id }"
                :title="uiLabels.frameBtnTitle"
                @click.stop="toggleFramingMode(panel.id)"
              >
                {{
                  framingPanelId === panel.id
                    ? pickComicBi('✓ 完成取景', '✓ Done Framing')
                    : pickComicBi('🔍 构图', '🔍 Frame')
                }}
              </button>
              <button
                v-if="panel.imageUrl"
                type="button"
                class="pf-btn"
                :class="{ 'pf-btn--active': panel.imageFlipX }"
                :title="pickComicBi('水平镜像翻转画面', 'Flip Horizontally')"
                @click.stop="
                  emit('update-panel', panel.id, { imageFlipX: !panel.imageFlipX }, true)
                "
              >
                ↔
              </button>
              <button
                type="button"
                class="pf-btn"
                :class="{ 'pf-btn--active': slantEditMode }"
                :title="uiLabels.slantBtnTitle"
                @click.stop="slantEditMode = !slantEditMode"
              >
                {{ pickComicBi('📐 斜切', '📐 Slant') }}
              </button>
              <button
                type="button"
                class="pf-btn"
                :class="{ 'pf-btn--active': panel.effectType === 'focus-lines' }"
                :title="pickComicBi('一键开关集中线特效', 'Toggle Focus Lines FX')"
                @click.stop="togglePanelEffect(panel, 'focus-lines')"
              >
                {{ pickComicBi('⚡ 集中线', '⚡ Focus') }}
              </button>
              <button
                type="button"
                class="pf-btn"
                :class="{ 'pf-btn--active': panel.effectType === 'speed-lines' }"
                :title="pickComicBi('一键开关速度线特效', 'Toggle Speed Lines FX')"
                @click.stop="togglePanelEffect(panel, 'speed-lines')"
              >
                {{ pickComicBi('💨 速度线', '💨 Speed') }}
              </button>
              <button
                type="button"
                class="pf-btn"
                :title="pickComicBi('添加对白气泡', 'Add Dialogue Bubble')"
                @click.stop="emit('quick-add-bubble', panel.id, 'oval')"
              >
                {{ pickComicBi('+气泡', '+Bubble') }}
              </button>
              <button
                type="button"
                class="pf-btn"
                :title="pickComicBi('添加拟声词特效字 (SFX)', 'Add SFX Sound Text')"
                @click.stop="emit('quick-add-bubble', panel.id, 'sfx')"
              >
                {{ pickComicBi('+拟声词', '+SFX') }}
              </button>
              <button
                v-if="panel.imageUrl"
                type="button"
                class="pf-btn pf-btn--danger"
                :title="t('graph.inspector.comicPage.clearImage')"
                @click.stop="emit('remove-image', panel.id)"
              >
                {{ pickComicBi('清图', 'Clear') }}
              </button>
              <button
                type="button"
                class="pf-btn pf-btn--danger"
                :title="t('graph.inspector.comicPage.removePanel')"
                @click.stop="emit('delete-panel', panel.id)"
              >
                🗑
              </button>
            </div>

            <!-- 调整跨格大小手柄：右缘改列跨、下缘改行跨、右下角两者联动 -->
            <template
              v-if="
                selectedPanelId === panel.id && !selectedBubbleId && framingPanelId !== panel.id
              "
            >
              <span
                class="rs rs-r"
                :title="pickComicBi('拖动调整列跨度 (colSpan)', 'Drag to resize column span')"
                @pointerdown.stop.prevent="onPanelResizeDown($event, panel, 'x')"
              />
              <span
                class="rs rs-b"
                :title="pickComicBi('拖动调整行跨度 (rowSpan)', 'Drag to resize row span')"
                @pointerdown.stop.prevent="onPanelResizeDown($event, panel, 'y')"
              />
              <span
                class="rs rs-br"
                :title="pickComicBi('拖动调整行列跨度', 'Drag to resize span')"
                @pointerdown.stop.prevent="onPanelResizeDown($event, panel, 'xy')"
              />
            </template>

            <!-- 四角斜切顶点手柄（开启斜切模式或已有斜切时显示） -->
            <template
              v-if="
                selectedPanelId === panel.id &&
                !selectedBubbleId &&
                (slantEditMode || panel.cornerOffsets)
              "
            >
              <span
                v-for="(corner, cIdx) in panelCornerHandleStyles(panel)"
                :key="`corner-${cIdx}`"
                class="corner-slant-handle"
                :style="corner.style"
                :title="uiLabels.cornerSlantTitle"
                @pointerdown.stop.prevent="onCornerSlantDown($event, panel, cIdx as 0 | 1 | 2 | 3)"
                @dblclick.stop="resetCornerSlant(panel, cIdx as 0 | 1 | 2 | 3)"
              />
            </template>

            <!-- 集中线中心锚点拖拽十字准星 -->
            <span
              v-if="
                selectedPanelId === panel.id &&
                !selectedBubbleId &&
                panel.effectType === 'focus-lines'
              "
              class="focus-center-handle"
              :style="{
                left: `${(panel.effectFocusX ?? 0.5) * 100}%`,
                top: `${(panel.effectFocusY ?? 0.5) * 100}%`
              }"
              :title="pickComicBi('拖动集中线视觉焦点', 'Drag Focus Lines Center')"
              @pointerdown.stop.prevent="onFocusCenterDown($event, panel)"
            >
              🎯
            </span>
          </div>
        </template>

        <!-- 选中气泡的精确交互包围盒、尾巴尖端控制柄、旋转柄、缩放柄与双击内联打字框 -->
        <div
          v-if="editable && selectedBubble && selectedBubblePanel && selectedBubbleBounds"
          class="bubble-selection-box"
          :style="selectedBubbleBoxStyle"
          @pointerdown.stop
        >
          <!-- 气泡悬浮快捷栏 -->
          <div v-if="!editingBubbleId && !drag" class="bubble-floating-bar">
            <button
              type="button"
              class="pf-btn"
              :title="pickComicBi('切换气泡形状', 'Cycle Bubble Shape')"
              @click.stop="cycleBubbleShape(selectedBubblePanel.id, selectedBubble)"
            >
              {{ bubbleShapeLabel(selectedBubble.shape ?? 'rounded') }}
            </button>
            <button
              type="button"
              class="pf-btn"
              :class="{ 'pf-btn--active': selectedBubble.writingMode === 'vertical-rl' }"
              :title="pickComicBi('切换横排/竖排文字', 'Toggle Horizontal / Vertical Text')"
              @click.stop="
                emit(
                  'update-bubble',
                  selectedBubblePanel.id,
                  selectedBubble.id,
                  {
                    writingMode:
                      selectedBubble.writingMode === 'vertical-rl' ? 'horizontal-tb' : 'vertical-rl'
                  },
                  true
                )
              "
            >
              {{
                selectedBubble.writingMode === 'vertical-rl'
                  ? pickComicBi('竖排', 'Vert')
                  : pickComicBi('横排', 'Horz')
              }}
            </button>
            <button
              type="button"
              class="pf-btn"
              :title="pickComicBi('双击或点此直接编辑台词', 'Edit Dialogue Inline')"
              @click.stop="startInlineEditBubble(selectedBubble)"
            >
              ✎
            </button>
            <button
              type="button"
              class="pf-btn"
              :title="pickComicBi('复制该气泡', 'Duplicate Bubble')"
              @click.stop="emit('duplicate-bubble', selectedBubblePanel.id, selectedBubble.id)"
            >
              ⧉
            </button>
            <button
              type="button"
              class="pf-btn pf-btn--danger"
              :title="t('graph.inspector.comicPage.removeBubble')"
              @click.stop="emit('delete-bubble', selectedBubblePanel.id, selectedBubble.id)"
            >
              🗑
            </button>
          </div>

          <!-- 旋转手柄（顶部） -->
          <button
            type="button"
            class="bubble-rotate-handle"
            :title="pickComicBi('拖动旋转气泡角度', 'Drag to rotate bubble')"
            tabindex="-1"
            @pointerdown.stop.prevent="
              onBubbleRotateDown($event, selectedBubblePanel, selectedBubble)
            "
          />

          <!-- 等比缩放手柄（右下角） -->
          <button
            type="button"
            class="bubble-resize"
            :title="pickComicBi('拖动等比缩放气泡与字号', 'Drag to scale bubble')"
            tabindex="-1"
            @pointerdown.stop.prevent="
              onBubbleScaleDown($event, selectedBubblePanel, selectedBubble)
            "
          />
        </div>

        <!-- 气泡尾巴尖端自由拖拽控制柄（黄色菱形） -->
        <button
          v-if="
            editable &&
            selectedBubble &&
            selectedBubblePanel &&
            selectedBubbleBounds &&
            selectedBubbleBounds.hasTail
          "
          type="button"
          class="bubble-tail-handle"
          :style="{
            left: `${(selectedBubbleBounds.tailTipX / (norm.width || 1)) * 100}%`,
            top: `${(selectedBubbleBounds.tailTipY / (norm.height || 1)) * 100}%`
          }"
          :title="uiLabels.bubbleTailTitle"
          @pointerdown.stop.prevent="onBubbleTailDown($event, selectedBubblePanel, selectedBubble)"
          @dblclick.stop="
            emit(
              'update-bubble',
              selectedBubblePanel.id,
              selectedBubble.id,
              { tailTipX: undefined, tailTipY: undefined },
              true
            )
          "
        />

        <!-- 双击气泡内联文字编辑浮层 -->
        <div
          v-if="
            editable &&
            editingBubbleId &&
            selectedBubble &&
            selectedBubblePanel &&
            selectedBubbleBounds
          "
          class="inline-bubble-editor"
          :style="{
            left: `${(selectedBubbleBounds.anchorX / (norm.width || 1)) * 100}%`,
            top: `${(selectedBubbleBounds.anchorY / (norm.height || 1)) * 100}%`
          }"
          @pointerdown.stop
        >
          <input
            v-model="inlineSpeakerText"
            class="inline-speaker-input"
            :placeholder="t('graph.inspector.comicPage.speaker')"
            @keydown.escape.stop="commitInlineBubbleEdit"
          />
          <textarea
            ref="inlineTextareaEl"
            v-model="inlineBubbleText"
            class="inline-text-input"
            rows="3"
            :placeholder="t('graph.inspector.comicPage.bubbleText')"
            @keydown.ctrl.enter.stop="commitInlineBubbleEdit"
            @keydown.meta.enter.stop="commitInlineBubbleEdit"
            @keydown.escape.stop="commitInlineBubbleEdit"
            @blur="commitInlineBubbleEdit"
          />
        </div>

        <span v-if="!editable && norm.panels.length === 0" class="empty-hint">
          {{ t('graph.inspector.comicPage.emptyPanels') }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  COMIC_BUBBLE_MAX_SCALE,
  COMIC_BUBBLE_MIN_SCALE,
  comicBubblePagePoint,
  comicGridMetrics,
  comicPanelPolygon,
  comicPanelRects,
  findComicBubbleAtPagePoint,
  findComicCellAtPagePoint,
  findComicPanelAtPagePoint,
  normalizeComicPage,
  pagePointToBubbleNorm,
  pagePointToTailTipNorm,
  zOrderedPanels,
  type ComicBubbleShape,
  type ComicCornerOffsets,
  type ComicPage,
  type ComicPanel,
  type ComicPanelEffectType,
  type ComicSpeechBubble
} from '@shared/graph'
import { resolveAssetPreviewUrl } from '../features/media/assetUrlCache'
import {
  composeComicPageImage,
  loadComicHtmlImage,
  renderComicPageToCanvas,
  type ComicPageRenderedLayout
} from '../features/comic/composeComicPageImage'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useProjectStore } from '../stores/project'
import {
  STUDIO_ASSET_DRAG_MIME,
  STUDIO_ASSET_ID_DRAG_MIME,
  STUDIO_ASSET_IDS_DRAG_MIME,
  useWorkspaceStore
} from '../stores/workspace'

export type ComicPageCanvasHit =
  | { kind: 'none' }
  | { kind: 'cell'; row: number; col: number }
  | { kind: 'panel'; panelId: string }
  | { kind: 'bubble'; panelId: string; bubbleId: string }

const props = defineProps<{
  page: ComicPage
  exportable?: boolean
  exportName?: string
  editable?: boolean
  selectedPanelId?: string | null
  selectedBubbleId?: string | null
}>()

const emit = defineEmits<{
  select: [hit: ComicPageCanvasHit]
  'move-bubble': [panelId: string, bubbleId: string, pos: { x: number; y: number }]
  'resize-panel': [panelId: string, span: { colSpan: number; rowSpan: number }]
  'resize-bubble': [panelId: string, bubbleId: string, scale: number]
  'edit-end': []
  'drop-image': [hit: ComicPageCanvasHit, imageUrl: string, extraUrls?: string[]]
  'remove-image': [panelId: string]
  'update-panel': [panelId: string, patch: Partial<ComicPanel>, persistNow?: boolean]
  'update-bubble': [
    panelId: string,
    bubbleId: string,
    patch: Partial<ComicSpeechBubble>,
    persistNow?: boolean
  ]
  'quick-add-panel': [row: number, col: number]
  'quick-add-bubble': [panelId: string, shape?: ComicBubbleShape]
  'delete-panel': [panelId: string]
  'delete-bubble': [panelId: string, bubbleId: string]
  'duplicate-bubble': [panelId: string, bubbleId: string]
  'swap-panels': [panelIdA: string, panelIdB: string]
}>()

const { t, locale } = useStudioI18n()
const workspace = useWorkspaceStore()
const project = useProjectStore()

function pickComicBi(zh: string, en: string): string {
  return String(locale.value || 'zh-CN')
    .toLowerCase()
    .startsWith('zh')
    ? zh
    : en
}

const uiLabels = computed(() => ({
  framingBanner: pickComicBi(
    '格内画面取景模式：拖拽平移焦点 · 滚轮缩放特写 · 双击空白处退出', // cjk-ok
    'Intra-panel Framing Mode: Drag to pan · Scroll to zoom · Double-click to exit'
  ),
  frameBtnTitle: pickComicBi(
    '调整格内画面位置与缩放 (或双击分镜)', // cjk-ok
    'Pan & zoom image inside panel (or double-click)'
  ),
  slantBtnTitle: pickComicBi(
    '开启四角斜切控制点（制作刀口斜分镜）', // cjk-ok
    'Toggle 4-corner diagonal slant handles'
  ),
  cornerSlantTitle: pickComicBi(
    '拖动顶点制作斜切分镜线 (双击复位该角)', // cjk-ok
    'Drag corner to slant panel (double-click to reset)'
  ),
  bubbleTailTitle: pickComicBi(
    '拖动尾巴尖端指向说话角色嘴部 (双击恢复默认)', // cjk-ok
    'Drag tail tip toward speaker (double-click to reset)'
  )
}))

const viewportEl = ref<HTMLElement | null>(null)
const pageEl = ref<HTMLElement | null>(null)
const renderCanvasEl = ref<HTMLCanvasElement | null>(null)
const inlineTextareaEl = ref<HTMLTextAreaElement | null>(null)

const norm = computed<ComicPage>(() => normalizeComicPage(props.page))
const rects = computed(() => comicPanelRects(norm.value))
const orderedPanels = computed(() => zOrderedPanels(norm.value))

/** 已加载的 HTMLImageElement 缓存（供实时 Canvas 同步绘制） */
const loadedImages = new Map<string, HTMLImageElement | null>()
const imageLoadVersion = ref(0)
const renderedLayout = ref<ComicPageRenderedLayout | null>(null)

/** 视口缩放与平移状态 */
const viewScale = ref(1)
const viewPanX = ref(0)
const viewPanY = ref(0)
const showGridGuides = ref(true)
const slantEditMode = ref(false)
const isSpacePressed = ref(false)

/** 格内画面取景模式（双击分镜格进入） */
const framingPanelId = ref<string | null>(null)
const framingPanel = computed(
  () => norm.value.panels.find((p) => p.id === framingPanelId.value) ?? null
)

/** 选中的空白单元格 */
const selectedCell = ref<{ row: number; col: number } | null>(null)

/** 双击内联编辑气泡 */
const editingBubbleId = ref<string | null>(null)
const inlineBubbleText = ref('')
const inlineSpeakerText = ref('')

const selectedBubblePanel = computed(
  () => norm.value.panels.find((p) => p.id === props.selectedPanelId) ?? null
)
const selectedBubble = computed(() => {
  if (!selectedBubblePanel.value || !props.selectedBubbleId) return null
  return selectedBubblePanel.value.bubbles.find((b) => b.id === props.selectedBubbleId) ?? null
})
const selectedBubbleBounds = computed(() => {
  if (!props.selectedBubbleId || !renderedLayout.value) return null
  return renderedLayout.value.bubbleBounds.get(props.selectedBubbleId) ?? null
})

const selectedBubbleBoxStyle = computed<Record<string, string>>(() => {
  const b = selectedBubbleBounds.value
  if (!b) return {}
  const w = norm.value.width || 1
  const h = norm.value.height || 1
  const rot = selectedBubble.value?.rotation ?? 0
  return {
    left: `${(b.x / w) * 100}%`,
    top: `${(b.y / h) * 100}%`,
    width: `${(b.width / w) * 100}%`,
    height: `${(b.height / h) * 100}%`,
    '--bubble-inv-rot': `${-rot}deg`,
    ...(rot ? { transform: `rotate(${rot}deg)` } : {})
  }
})

const pageStageStyle = computed<Record<string, string>>(() => {
  if (!props.editable) {
    const out: Record<string, string> = {
      aspectRatio: `${norm.value.width} / ${norm.value.height}`
    }
    if (norm.value.backgroundColor) {
      out.background = norm.value.backgroundColor
    }
    return out
  }
  const safeScale = Math.max(0.15, viewScale.value || 1)
  return {
    width: `${norm.value.width}px`,
    height: `${norm.value.height}px`,
    transform: `translate(${viewPanX.value}px, ${viewPanY.value}px) scale(${safeScale})`,
    transformOrigin: 'center center',
    '--view-scale': String(safeScale),
    '--inv-scale': String(Math.round((1 / safeScale) * 10000) / 10000)
  }
})

const occupied = computed(() => {
  const keys = new Set<string>()
  for (const panel of norm.value.panels) {
    for (let r = panel.row; r < panel.row + panel.rowSpan; r++) {
      for (let c = panel.col; c < panel.col + panel.colSpan; c++) {
        keys.add(`${r},${c}`)
      }
    }
  }
  return keys
})

const gridCells = computed(() => {
  const cells: Array<{ row: number; col: number; occupied: boolean }> = []
  for (let row = 0; row < norm.value.rows; row++) {
    for (let col = 0; col < norm.value.columns; col++) {
      cells.push({ row, col, occupied: occupied.value.has(`${row},${col}`) })
    }
  }
  return cells
})

const selectedPanelPolygon = computed<string | null>(() => {
  if (!props.selectedPanelId) return null
  const panel = norm.value.panels.find((p) => p.id === props.selectedPanelId)
  const rect = rects.value.get(props.selectedPanelId)
  if (!panel || !rect) return null
  const effectiveRect =
    panelResize.value && panelResize.value.panelId === panel.id
      ? { ...rect, width: panelResize.value.width, height: panelResize.value.height }
      : rect
  const pts = comicPanelPolygon(effectiveRect, panel)
  return pts.map((p) => `${p.x},${p.y}`).join(' ')
})

const dragOverPanelPolygon = computed<string | null>(() => {
  if (!dragOverKey.value?.startsWith('panel:')) return null
  const panelId = dragOverKey.value.slice('panel:'.length)
  const panel = norm.value.panels.find((p) => p.id === panelId)
  const rect = rects.value.get(panelId)
  if (!panel || !rect) return null
  const pts = comicPanelPolygon(rect, panel)
  return pts.map((p) => `${p.x},${p.y}`).join(' ')
})

async function resolveThumb(url: string): Promise<string> {
  if (!url) return ''
  if (url.startsWith('data:') || /^https?:\/\//i.test(url)) return url
  return resolveAssetPreviewUrl(url)
}

async function ensureImagesLoaded(): Promise<void> {
  const urls = new Set<string>()
  for (const panel of norm.value.panels) {
    if (panel.imageUrl) urls.add(panel.imageUrl)
  }
  let changed = false
  await Promise.all(
    [...urls].map(async (url) => {
      if (loadedImages.has(url)) return
      loadedImages.set(url, null)
      try {
        const resolved = await resolveThumb(url)
        if (!resolved) return
        const img = await loadComicHtmlImage(resolved)
        loadedImages.set(url, img)
        changed = true
      } catch {
        /* 保持 null */
      }
    })
  )
  if (changed) {
    imageLoadVersion.value += 1
    repaintCanvas()
  }
}

function repaintCanvas(): void {
  const canvas = renderCanvasEl.value
  if (!canvas) return
  try {
    renderedLayout.value = renderComicPageToCanvas(canvas, norm.value, loadedImages)
  } catch {
    /* 忽略测试环境无 2d context 异常 */
  }
}

watch(
  () => [props.page, imageLoadVersion.value] as const,
  () => {
    void ensureImagesLoaded()
    nextTick(repaintCanvas)
  },
  { immediate: true, deep: true }
)

watch(
  () => props.selectedPanelId,
  (id) => {
    if (framingPanelId.value && framingPanelId.value !== id) {
      framingPanelId.value = null
    }
  }
)

watch(
  () => props.selectedBubbleId,
  (id) => {
    if (editingBubbleId.value && editingBubbleId.value !== id) {
      editingBubbleId.value = null
    }
  }
)

function fitToViewport(): void {
  if (!props.editable) return
  const vp = viewportEl.value
  if (!vp) return
  const box = vp.getBoundingClientRect()
  if (box.width <= 40 || box.height <= 40) return
  const padX = 64
  const padY = 108
  const scaleX = (box.width - padX) / Math.max(1, norm.value.width)
  const scaleY = (box.height - padY) / Math.max(1, norm.value.height)
  viewScale.value = Math.round(Math.min(1.5, Math.max(0.18, Math.min(scaleX, scaleY))) * 100) / 100
  viewPanX.value = 0
  viewPanY.value = 18
}

function setZoom100(): void {
  viewScale.value = 1
  viewPanX.value = 0
  viewPanY.value = 0
}

function stepZoom(delta: number): void {
  viewScale.value = Math.round(Math.min(3, Math.max(0.18, viewScale.value + delta)) * 100) / 100
}

function onViewportWheel(e: WheelEvent): void {
  if (!props.editable) return
  // 若正处于分镜格构图取景模式，或按住 Alt 在选中分镜上滚轮，则直接缩放格内画面特写！
  if (!e.ctrlKey && !e.metaKey && (framingPanel.value || (e.altKey && props.selectedPanelId))) {
    const targetPanel =
      framingPanel.value ?? norm.value.panels.find((p) => p.id === props.selectedPanelId)
    if (targetPanel?.imageUrl) {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 0.1 : -0.1
      const nextZoom =
        Math.round(Math.min(4, Math.max(0.5, (targetPanel.imageZoom ?? 1) + factor)) * 100) / 100
      emit('update-panel', targetPanel.id, { imageZoom: nextZoom }, true)
      return
    }
  }
  e.preventDefault()
  if (e.ctrlKey || e.metaKey) {
    const factor = e.deltaY < 0 ? 0.1 : -0.1
    stepZoom(factor)
  } else {
    viewPanX.value -= e.deltaX
    viewPanY.value -= e.deltaY
  }
}

function onViewportPointerDown(e: PointerEvent): void {
  if (!props.editable) return
  // 中键或按住 Space 键拖拽平移视口
  if (e.button === 1 || (e.button === 0 && isSpacePressed.value)) {
    e.preventDefault()
    drag.value = {
      kind: 'viewport-pan',
      startClientX: e.clientX,
      startClientY: e.clientY,
      panX0: viewPanX.value,
      panY0: viewPanY.value
    }
    viewportEl.value?.setPointerCapture(e.pointerId)
    return
  }
  // 点击画布外围暗色背景处：取消选中并回到全局属性
  if (e.target === viewportEl.value) {
    framingPanelId.value = null
    selectedCell.value = null
    emit('select', { kind: 'none' })
  }
}

function panelStyle(panel: ComicPanel): Record<string, string> {
  const rect = rects.value.get(panel.id)
  if (!rect) return {}
  const w = norm.value.width || 1
  const h = norm.value.height || 1
  return {
    left: `${(rect.x / w) * 100}%`,
    top: `${(rect.y / h) * 100}%`,
    width: `${(rect.width / w) * 100}%`,
    height: `${(rect.height / h) * 100}%`
  }
}

function panelCornerHandleStyles(panel: ComicPanel): Array<{ style: Record<string, string> }> {
  const o = panel.cornerOffsets ?? [0, 0, 0, 0, 0, 0, 0, 0]
  return [
    { style: { left: `${o[0] * 100}%`, top: `${o[1] * 100}%` } },
    { style: { left: `${(1 + o[2]) * 100}%`, top: `${o[3] * 100}%` } },
    { style: { left: `${(1 + o[4]) * 100}%`, top: `${(1 + o[5]) * 100}%` } },
    { style: { left: `${o[6] * 100}%`, top: `${(1 + o[7]) * 100}%` } }
  ]
}

function cellStyle(cell: { row: number; col: number }): Record<string, string> {
  const { pad, colW, rowH, gutter, width, height } = comicGridMetrics(norm.value)
  const x = pad + cell.col * (colW + gutter)
  const y = pad + cell.row * (rowH + gutter)
  return {
    left: `${(x / width) * 100}%`,
    top: `${(y / height) * 100}%`,
    width: `${(colW / width) * 100}%`,
    height: `${(rowH / height) * 100}%`
  }
}

function clientToPage(e: { clientX: number; clientY: number }): { x: number; y: number } | null {
  const el = pageEl.value
  if (!el) return null
  const box = el.getBoundingClientRect()
  if (box.width <= 0 || box.height <= 0) return null
  return {
    x: ((e.clientX - box.left) / box.width) * norm.value.width,
    y: ((e.clientY - box.top) / box.height) * norm.value.height
  }
}

/** 精确气泡命中测试：优先检测已渲染的气泡矩形包围盒，回退到锚点半径检测 */
function hitTestBubbleAtPagePoint(pt: {
  x: number
  y: number
}): { panelId: string; bubbleId: string } | null {
  const layout = renderedLayout.value
  if (layout && layout.bubbleBounds.size > 0) {
    const entries = Array.from(layout.bubbleBounds.values()).reverse()
    for (const b of entries) {
      const pad = 6
      if (
        pt.x >= b.x - pad &&
        pt.x <= b.x + b.width + pad &&
        pt.y >= b.y - pad &&
        pt.y <= b.y + b.height + pad
      ) {
        return { panelId: b.panelId, bubbleId: b.bubbleId }
      }
    }
  }
  return findComicBubbleAtPagePoint(norm.value, pt.x, pt.y)
}

type CanvasDrag =
  | {
      kind: 'viewport-pan'
      startClientX: number
      startClientY: number
      panX0: number
      panY0: number
    }
  | { kind: 'bubble'; panelId: string; bubbleId: string }
  | { kind: 'bubble-tail'; panelId: string; bubbleId: string }
  | {
      kind: 'bubble-rotate'
      panelId: string
      bubbleId: string
      anchorX: number
      anchorY: number
    }
  | {
      kind: 'panel-resize'
      panelId: string
      axis: 'x' | 'y' | 'xy'
      startX: number
      startY: number
      rect: { x: number; y: number; width: number; height: number }
      col0: number
      row0: number
      lastColSpan: number
      lastRowSpan: number
    }
  | {
      kind: 'panel-image-pan'
      panelId: string
      startX: number
      startY: number
      panX0: number
      panY0: number
      rectW: number
      rectH: number
    }
  | {
      kind: 'panel-corner-slant'
      panelId: string
      cornerIndex: 0 | 1 | 2 | 3
      startX: number
      startY: number
      rectW: number
      rectH: number
      baseOffsets: ComicCornerOffsets
    }
  | {
      kind: 'panel-focus-center'
      panelId: string
    }
  | {
      kind: 'bubble-scale'
      panelId: string
      bubbleId: string
      anchorX: number
      anchorY: number
      startDist: number
      startScale: number
      lastScale: number
    }

const drag = ref<CanvasDrag | null>(null)
const panelResize = ref<{ panelId: string; width: number; height: number } | null>(null)

function panelResizeOverlay(panel: ComicPanel): Record<string, string> {
  const st = panelResize.value
  if (!st || st.panelId !== panel.id) return {}
  return {
    width: `${(st.width / (norm.value.width || 1)) * 100}%`,
    height: `${(st.height / (norm.value.height || 1)) * 100}%`
  }
}

function onPagePointerDown(e: PointerEvent): void {
  if (!props.editable || e.button !== 0) return
  if (isSpacePressed.value) return
  const pt = clientToPage(e)
  if (!pt) return

  // 1. 优先命中气泡
  const bubbleHit = hitTestBubbleAtPagePoint(pt)
  const panel = findComicPanelAtPagePoint(norm.value, pt.x, pt.y)
  if (
    bubbleHit &&
    (!panel || bubbleHit.panelId === panel.id || props.selectedBubbleId === bubbleHit.bubbleId)
  ) {
    selectedCell.value = null
    framingPanelId.value = null
    emit('select', { kind: 'bubble', panelId: bubbleHit.panelId, bubbleId: bubbleHit.bubbleId })
    drag.value = { kind: 'bubble', panelId: bubbleHit.panelId, bubbleId: bubbleHit.bubbleId }
    pageEl.value?.setPointerCapture(e.pointerId)
    e.preventDefault()
    return
  }

  // 2. 命中分镜格
  if (panel) {
    selectedCell.value = null
    emit('select', { kind: 'panel', panelId: panel.id })
    // 若当前处于格内构图取景模式（或按住 Alt 键拖拽），直接拖拽平移格内画面焦点！
    if ((framingPanelId.value === panel.id || e.altKey) && panel.imageUrl) {
      const rect = rects.value.get(panel.id)
      if (rect) {
        drag.value = {
          kind: 'panel-image-pan',
          panelId: panel.id,
          startX: pt.x,
          startY: pt.y,
          panX0: panel.imagePanX ?? 0,
          panY0: panel.imagePanY ?? 0,
          rectW: Math.max(1, rect.width),
          rectH: Math.max(1, rect.height)
        }
        pageEl.value?.setPointerCapture(e.pointerId)
        e.preventDefault()
      }
    }
    return
  }

  // 3. 命中空白网格单元
  framingPanelId.value = null
  const cell = findComicCellAtPagePoint(norm.value, pt.x, pt.y)
  if (cell) {
    selectedCell.value = cell
    emit('select', { kind: 'cell', row: cell.row, col: cell.col })
    return
  }
  selectedCell.value = null
  emit('select', { kind: 'none' })
}

function onPageDoubleClick(e: MouseEvent): void {
  if (!props.editable) return
  const pt = clientToPage(e)
  if (!pt) return

  // 双击气泡 → 直接启动画布内联文字编辑
  const bubbleHit = hitTestBubbleAtPagePoint(pt)
  if (bubbleHit) {
    const p = norm.value.panels.find((item) => item.id === bubbleHit.panelId)
    const b = p?.bubbles.find((item) => item.id === bubbleHit.bubbleId)
    if (b) {
      emit('select', { kind: 'bubble', panelId: bubbleHit.panelId, bubbleId: bubbleHit.bubbleId })
      startInlineEditBubble(b)
      return
    }
  }

  // 双击有图的分镜格 → 切换格内画面取景模式（Pan / Zoom）
  const panel = findComicPanelAtPagePoint(norm.value, pt.x, pt.y)
  if (panel && panel.imageUrl) {
    toggleFramingMode(panel.id)
    return
  }

  // 双击空白网格单元 → 直接新建分镜格
  if (!panel) {
    framingPanelId.value = null
    const cell = findComicCellAtPagePoint(norm.value, pt.x, pt.y)
    if (cell) {
      emit('quick-add-panel', cell.row, cell.col)
    }
  }
}

function toggleFramingMode(panelId: string): void {
  framingPanelId.value = framingPanelId.value === panelId ? null : panelId
}

function resetPanelFraming(panelId: string): void {
  emit(
    'update-panel',
    panelId,
    {
      imagePanX: 0,
      imagePanY: 0,
      imageZoom: 1,
      imageRotation: 0,
      imageFlipX: false
    },
    true
  )
}

function togglePanelEffect(panel: ComicPanel, effectType: ComicPanelEffectType): void {
  const next = panel.effectType === effectType ? 'none' : effectType
  emit('update-panel', panel.id, { effectType: next }, true)
}

function cycleBubbleShape(panelId: string, bubble: ComicSpeechBubble): void {
  const order: ComicBubbleShape[] = ['rounded', 'oval', 'shout', 'thought', 'narration', 'sfx']
  const cur = bubble.shape ?? 'rounded'
  const next = order[(order.indexOf(cur) + 1) % order.length]!
  emit('update-bubble', panelId, bubble.id, { shape: next }, true)
}

function bubbleShapeLabel(shape: ComicBubbleShape): string {
  switch (shape) {
    case 'oval':
      return pickComicBi('💬 椭圆', '💬 Oval')
    case 'shout':
      return pickComicBi('💥 呐喊', '💥 Shout')
    case 'thought':
      return pickComicBi('💭 心理', '💭 Thought')
    case 'narration':
      return pickComicBi('📝 旁白', '📝 Box')
    case 'sfx':
      return pickComicBi('🔊 拟声词', '🔊 SFX')
    default:
      return pickComicBi('💬 圆角', '💬 Round')
  }
}

function startInlineEditBubble(bubble: ComicSpeechBubble): void {
  editingBubbleId.value = bubble.id
  inlineBubbleText.value = bubble.text
  inlineSpeakerText.value = bubble.speaker ?? ''
  void nextTick(() => {
    inlineTextareaEl.value?.focus()
    inlineTextareaEl.value?.select()
  })
}

function commitInlineBubbleEdit(): void {
  if (!editingBubbleId.value || !props.selectedPanelId) return
  const bId = editingBubbleId.value
  editingBubbleId.value = null
  const text = inlineBubbleText.value.trim()
  if (!text) return
  emit(
    'update-bubble',
    props.selectedPanelId,
    bId,
    { text, speaker: inlineSpeakerText.value.trim() },
    true
  )
}

function onPagePointerMove(e: PointerEvent): void {
  const st = drag.value
  if (!st) return

  if (st.kind === 'viewport-pan') {
    viewPanX.value = st.panX0 + (e.clientX - st.startClientX)
    viewPanY.value = st.panY0 + (e.clientY - st.startClientY)
    return
  }

  const pt = clientToPage(e)
  if (!pt) return

  if (st.kind === 'bubble') {
    const pos = pagePointToBubbleNorm(norm.value, st.panelId, pt.x, pt.y)
    if (pos) emit('move-bubble', st.panelId, st.bubbleId, pos)
    return
  }

  if (st.kind === 'bubble-tail') {
    const tip = pagePointToTailTipNorm(norm.value, st.panelId, pt.x, pt.y)
    if (tip) {
      emit('update-bubble', st.panelId, st.bubbleId, tip, false)
    }
    return
  }

  if (st.kind === 'bubble-rotate') {
    const deg = Math.round((Math.atan2(pt.y - st.anchorY, pt.x - st.anchorX) * 180) / Math.PI + 90)
    const clamped = Math.max(-60, Math.min(60, deg))
    emit('update-bubble', st.panelId, st.bubbleId, { rotation: clamped }, false)
    return
  }

  if (st.kind === 'panel-image-pan') {
    const dx = (pt.x - st.startX) / (st.rectW * 0.5)
    const dy = (pt.y - st.startY) / (st.rectH * 0.5)
    const imagePanX = Math.max(-1, Math.min(1, Math.round((st.panX0 + dx) * 1000) / 1000))
    const imagePanY = Math.max(-1, Math.min(1, Math.round((st.panY0 + dy) * 1000) / 1000))
    emit('update-panel', st.panelId, { imagePanX, imagePanY }, false)
    return
  }

  if (st.kind === 'panel-corner-slant') {
    const dx = (pt.x - st.startX) / st.rectW
    const dy = (pt.y - st.startY) / st.rectH
    const next = [...st.baseOffsets] as ComicCornerOffsets
    const ix = st.cornerIndex * 2
    next[ix] = Math.max(-0.4, Math.min(0.4, Math.round((st.baseOffsets[ix]! + dx) * 1000) / 1000))
    next[ix + 1] = Math.max(
      -0.4,
      Math.min(0.4, Math.round((st.baseOffsets[ix + 1]! + dy) * 1000) / 1000)
    )
    emit('update-panel', st.panelId, { cornerOffsets: next }, false)
    return
  }

  if (st.kind === 'panel-focus-center') {
    const pos = pagePointToBubbleNorm(norm.value, st.panelId, pt.x, pt.y)
    if (pos) {
      emit(
        'update-panel',
        st.panelId,
        {
          effectFocusX: Math.round(pos.x * 1000) / 1000,
          effectFocusY: Math.round(pos.y * 1000) / 1000
        },
        false
      )
    }
    return
  }

  if (st.kind === 'panel-resize') {
    const { colW: cellW, rowH: cellH, columns, rows, gutter } = comicGridMetrics(norm.value)
    const colsLeft = columns - st.col0
    const rowsLeft = rows - st.row0
    const maxW = colsLeft * cellW + (colsLeft - 1) * gutter
    const maxH = rowsLeft * cellH + (rowsLeft - 1) * gutter
    const dragW =
      st.axis === 'y'
        ? st.rect.width
        : Math.min(maxW, Math.max(cellW * 0.5, st.rect.width + (pt.x - st.startX)))
    const dragH =
      st.axis === 'x'
        ? st.rect.height
        : Math.min(maxH, Math.max(cellH * 0.5, st.rect.height + (pt.y - st.startY)))
    panelResize.value = { panelId: st.panelId, width: dragW, height: dragH }

    const pitchW = cellW + gutter
    const pitchH = cellH + gutter
    let colSpan = st.lastColSpan
    let rowSpan = st.lastRowSpan
    if (st.axis !== 'y') {
      colSpan = Math.min(
        columns - st.col0,
        Math.max(1, Math.round((st.rect.width + (pt.x - st.startX) + gutter) / pitchW))
      )
    }
    if (st.axis !== 'x') {
      rowSpan = Math.min(
        rows - st.row0,
        Math.max(1, Math.round((st.rect.height + (pt.y - st.startY) + gutter) / pitchH))
      )
    }
    if (colSpan !== st.lastColSpan || rowSpan !== st.lastRowSpan) {
      st.lastColSpan = colSpan
      st.lastRowSpan = rowSpan
      emit('resize-panel', st.panelId, { colSpan, rowSpan })
    }
    return
  }

  // bubble-scale：按距锚点距离的比例等比缩放
  const dist = Math.max(8, Math.hypot(pt.x - st.anchorX, pt.y - st.anchorY))
  const scale = Math.min(
    COMIC_BUBBLE_MAX_SCALE,
    Math.max(COMIC_BUBBLE_MIN_SCALE, (st.startScale * dist) / st.startDist)
  )
  const snapped = Math.round(scale * 100) / 100
  if (snapped !== st.lastScale) {
    st.lastScale = snapped
    emit('resize-bubble', st.panelId, st.bubbleId, snapped)
  }
}

function onPagePointerUp(): void {
  const wasDragging = !!drag.value && drag.value.kind !== 'viewport-pan'
  drag.value = null
  panelResize.value = null
  if (wasDragging) emit('edit-end')
}

function onPanelResizeDown(e: PointerEvent, panel: ComicPanel, axis: 'x' | 'y' | 'xy'): void {
  const rect = rects.value.get(panel.id)
  const pt = clientToPage(e)
  if (!rect || !pt) return
  emit('select', { kind: 'panel', panelId: panel.id })
  drag.value = {
    kind: 'panel-resize',
    panelId: panel.id,
    axis,
    startX: pt.x,
    startY: pt.y,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    col0: panel.col,
    row0: panel.row,
    lastColSpan: panel.colSpan,
    lastRowSpan: panel.rowSpan
  }
  pageEl.value?.setPointerCapture(e.pointerId)
}

function onCornerSlantDown(e: PointerEvent, panel: ComicPanel, cornerIndex: 0 | 1 | 2 | 3): void {
  const rect = rects.value.get(panel.id)
  const pt = clientToPage(e)
  if (!rect || !pt) return
  const baseOffsets: ComicCornerOffsets = panel.cornerOffsets
    ? ([...panel.cornerOffsets] as ComicCornerOffsets)
    : [0, 0, 0, 0, 0, 0, 0, 0]
  drag.value = {
    kind: 'panel-corner-slant',
    panelId: panel.id,
    cornerIndex,
    startX: pt.x,
    startY: pt.y,
    rectW: Math.max(1, rect.width),
    rectH: Math.max(1, rect.height),
    baseOffsets
  }
  pageEl.value?.setPointerCapture(e.pointerId)
}

function resetCornerSlant(panel: ComicPanel, cornerIndex: 0 | 1 | 2 | 3): void {
  if (!panel.cornerOffsets) return
  const next = [...panel.cornerOffsets] as ComicCornerOffsets
  next[cornerIndex * 2] = 0
  next[cornerIndex * 2 + 1] = 0
  emit('update-panel', panel.id, { cornerOffsets: next }, true)
}

function onFocusCenterDown(e: PointerEvent, panel: ComicPanel): void {
  drag.value = { kind: 'panel-focus-center', panelId: panel.id }
  pageEl.value?.setPointerCapture(e.pointerId)
}

function onBubbleScaleDown(e: PointerEvent, panel: ComicPanel, bubble: ComicSpeechBubble): void {
  const anchor = comicBubblePagePoint(norm.value, panel.id, bubble.id)
  const pt = clientToPage(e)
  if (!anchor || !pt) return
  emit('select', { kind: 'bubble', panelId: panel.id, bubbleId: bubble.id })
  drag.value = {
    kind: 'bubble-scale',
    panelId: panel.id,
    bubbleId: bubble.id,
    anchorX: anchor.x,
    anchorY: anchor.y,
    startDist: Math.max(8, Math.hypot(pt.x - anchor.x, pt.y - anchor.y)),
    startScale: bubble.scale ?? 1,
    lastScale: bubble.scale ?? 1
  }
  pageEl.value?.setPointerCapture(e.pointerId)
}

function onBubbleRotateDown(e: PointerEvent, panel: ComicPanel, bubble: ComicSpeechBubble): void {
  const anchor = comicBubblePagePoint(norm.value, panel.id, bubble.id)
  if (!anchor) return
  drag.value = {
    kind: 'bubble-rotate',
    panelId: panel.id,
    bubbleId: bubble.id,
    anchorX: anchor.x,
    anchorY: anchor.y
  }
  pageEl.value?.setPointerCapture(e.pointerId)
}

function onBubbleTailDown(e: PointerEvent, panel: ComicPanel, bubble: ComicSpeechBubble): void {
  emit('select', { kind: 'bubble', panelId: panel.id, bubbleId: bubble.id })
  drag.value = {
    kind: 'bubble-tail',
    panelId: panel.id,
    bubbleId: bubble.id
  }
  pageEl.value?.setPointerCapture(e.pointerId)
}

/** 资产库或侧边栏图片拖入高亮目标：panel:<id> / cell:<row>,<col> */
const dragOverKey = ref<string | null>(null)
const CUSTOM_COMIC_IMAGE_MIME = 'text/x-comic-image-url'

function isSupportedImageDrag(event: DragEvent): boolean {
  if (workspace.draggingAsset) return true
  const types = event.dataTransfer ? Array.from(event.dataTransfer.types) : []
  return (
    types.includes(CUSTOM_COMIC_IMAGE_MIME) ||
    types.includes(STUDIO_ASSET_DRAG_MIME) ||
    types.includes(STUDIO_ASSET_ID_DRAG_MIME) ||
    types.includes(STUDIO_ASSET_IDS_DRAG_MIME)
  )
}

function dropTargetAt(pt: { x: number; y: number }): ComicPageCanvasHit {
  const panel = findComicPanelAtPagePoint(norm.value, pt.x, pt.y)
  if (panel) return { kind: 'panel', panelId: panel.id }
  const cell = findComicCellAtPagePoint(norm.value, pt.x, pt.y)
  if (cell) return { kind: 'cell', row: cell.row, col: cell.col }
  return { kind: 'none' }
}

function dropTargetKey(hit: ComicPageCanvasHit): string | null {
  if (hit.kind === 'panel') return `panel:${hit.panelId}`
  if (hit.kind === 'cell') return `cell:${hit.row},${hit.col}`
  return null
}

function onPageDragEnter(event: DragEvent): void {
  if (!props.editable || !isSupportedImageDrag(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onPageDragOver(event: DragEvent): void {
  if (!props.editable || !isSupportedImageDrag(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  const pt = clientToPage(event)
  dragOverKey.value = pt ? dropTargetKey(dropTargetAt(pt)) : null
}

function onPageDragLeave(event: DragEvent): void {
  const next = event.relatedTarget as Node | null
  const zone = event.currentTarget as HTMLElement | null
  if (next && zone?.contains(next)) return
  dragOverKey.value = null
}

function onPageDrop(event: DragEvent): void {
  dragOverKey.value = null
  if (!props.editable || !isSupportedImageDrag(event)) return

  const urls: string[] = []
  const directUrl = event.dataTransfer?.getData(CUSTOM_COMIC_IMAGE_MIME)?.trim()
  if (directUrl) {
    urls.push(directUrl)
  } else {
    const idsRaw = event.dataTransfer?.getData(STUDIO_ASSET_IDS_DRAG_MIME)
    if (idsRaw) {
      try {
        const ids = JSON.parse(idsRaw) as unknown
        if (Array.isArray(ids)) {
          for (const id of ids) {
            if (typeof id !== 'string') continue
            const found = project.assets.find((a) => a.id === id)
            const rel = found?.type === 'image' ? found.relativePath?.trim() : ''
            if (rel) urls.push(rel)
          }
        }
      } catch {
        /* 忽略解析异常，回退到单资产解析 */
      }
    }
    if (!urls.length) {
      const asset = workspace.resolveDraggedAsset(event)
      if (asset && asset.type === 'image' && asset.relativePath?.trim()) {
        urls.push(asset.relativePath.trim())
      }
    }
  }

  if (!urls.length) return
  const pt = clientToPage(event)
  const target: ComicPageCanvasHit = pt ? dropTargetAt(pt) : { kind: 'none' }
  event.preventDefault()
  emit('drop-image', target, urls[0]!, urls.length > 1 ? urls.slice(1) : undefined)
}

const exporting = ref(false)
const exportMessage = ref('')
const exportFailed = ref(false)

async function resolveExportImage(url: string): Promise<string> {
  if (!url) return ''
  if (url.startsWith('data:') || /^https?:\/\//i.test(url)) return url
  try {
    const dataUrl = await window.studio.getAssetMediaDataUrl(url)
    if (dataUrl) return dataUrl
  } catch {
    /* 回退到预览 URL */
  }
  return resolveAssetPreviewUrl(url)
}

function dataUrlToBytes(url: string): Uint8Array {
  const match = url.match(/^data:[^;,]+(;base64)?,([\s\S]*)$/i)
  if (!match) throw new Error('invalid data URL')
  const isBase64 = !!match[1]
  const binary = isBase64 ? atob(match[2]!) : decodeURIComponent(match[2]!)
  const data = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) data[i] = binary.charCodeAt(i)
  return data
}

function safeFileBase(name: string): string {
  const base = name
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\.+$/, '')
    .trim()
  return base || 'comic-page'
}

async function exportPng(): Promise<void> {
  if (exporting.value || norm.value.panels.length === 0) return
  exporting.value = true
  exportMessage.value = ''
  exportFailed.value = false
  try {
    const result = await composeComicPageImage({
      page: norm.value,
      resolveImage: resolveExportImage
    })
    const data = dataUrlToBytes(result.dataUrl)
    const base = safeFileBase(props.exportName?.trim() || 'comic-page')
    const saved = await window.studio.saveBinaryFilesToDirectory({
      files: [{ fileName: `${base}.png`, data }]
    })
    if (!saved) {
      exportFailed.value = true
      exportMessage.value = t('graph.inspector.comicPage.exportCancel')
    } else {
      exportMessage.value = t('graph.inspector.comicPage.exportDone', { count: saved.written })
    }
  } catch (err) {
    exportFailed.value = true
    exportMessage.value = err instanceof Error ? err.message : String(err)
  } finally {
    exporting.value = false
  }
}

function onKeyDown(e: KeyboardEvent): void {
  if (!props.editable) return
  const target = e.target as HTMLElement | null
  if (
    target &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
  ) {
    return
  }
  if (e.code === 'Space') {
    isSpacePressed.value = true
  }
}

function onKeyUp(e: KeyboardEvent): void {
  if (e.code === 'Space') {
    isSpacePressed.value = false
  }
}

onMounted(() => {
  if (props.editable) {
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    nextTick(() => fitToViewport())
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
})

defineExpose({ exportPng, fitToViewport, setZoom100 })
</script>

<style scoped>
.comic-page-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  flex: 1;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.export-btn {
  padding: 4px 10px;
  font-size: 11px;
  color: var(--accent);
  background: transparent;
  border: 1px solid var(--accent);
  border-radius: 6px;
  cursor: pointer;
}
.export-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.export-msg {
  font-size: 11px;
  color: var(--text-muted);
}
.export-msg--error {
  color: var(--danger);
}

.comic-viewport {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.comic-viewport--studio {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background:
    radial-gradient(circle at center, rgb(255 255 255 / 0.04) 1px, transparent 1px),
    var(--bg-canvas, #121318);
  background-size: 20px 20px;
  border: 1px solid var(--border);
  border-radius: 10px;
}
.comic-viewport--panning {
  cursor: grab !important;
}

.framing-banner {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  font-size: 12px;
  color: #fff;
  background: rgb(15 23 42 / 0.92);
  border: 1px solid var(--accent);
  border-radius: 999px;
  box-shadow: 0 6px 20px rgb(0 0 0 / 0.35);
  backdrop-filter: blur(8px);
}
.framing-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 8px #22c55e;
}
.framing-btn {
  padding: 2px 10px;
  font-size: 11px;
  color: #e2e8f0;
  background: rgb(255 255 255 / 0.1);
  border: 1px solid rgb(255 255 255 / 0.2);
  border-radius: 999px;
  cursor: pointer;
}
.framing-btn--primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.zoom-bar {
  position: absolute;
  right: 14px;
  bottom: 14px;
  z-index: 25;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  background: rgb(18 20 28 / 0.88);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.28);
  backdrop-filter: blur(8px);
}
.zoom-btn,
.zoom-readout {
  height: 24px;
  padding: 0 8px;
  font-size: 11px;
  color: var(--text);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 5px;
  cursor: pointer;
}
.zoom-btn:hover,
.zoom-readout:hover {
  background: rgb(255 255 255 / 0.08);
}
.zoom-btn--active {
  color: var(--accent);
  border-color: var(--accent);
}
.zoom-readout {
  min-width: 46px;
  font-variant-numeric: tabular-nums;
}

.comic-page {
  position: relative;
  width: 100%;
  overflow: visible;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  touch-action: none;
  box-shadow: 0 12px 36px rgb(0 0 0 / 0.35);
}
.comic-page--transparent {
  background-image:
    linear-gradient(45deg, rgb(128 128 128 / 0.12) 25%, transparent 25%),
    linear-gradient(-45deg, rgb(128 128 128 / 0.12) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgb(128 128 128 / 0.12) 75%),
    linear-gradient(-45deg, transparent 75%, rgb(128 128 128 / 0.12) 75%);
  background-size: 20px 20px;
  background-position:
    0 0,
    0 10px,
    10px -10px,
    -10px 0;
}
.comic-page--editable {
  cursor: default;
  user-select: none;
  flex-shrink: 0;
}

.comic-render-canvas {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 5px;
  pointer-events: none;
}

.comic-overlay-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 4;
  pointer-events: none;
  overflow: visible;
}
.svg-panel-selected {
  fill: none;
  stroke: var(--accent, #6366f1);
  stroke-width: 4;
  vector-effect: non-scaling-stroke;
}
.svg-panel-selected--framing {
  stroke: #22c55e;
  stroke-dasharray: 6 4;
}
.svg-panel-drop-highlight {
  fill: rgb(22 163 74 / 0.18);
  stroke: #16a34a;
  stroke-width: 4;
}
.svg-tail-guide {
  stroke: #f59e0b;
  stroke-width: 2;
  stroke-dasharray: 5 4;
}

.grid-cell {
  position: absolute;
  margin: 0;
  padding: 0;
  border: 1.5px dashed rgb(148 163 184 / 0.35);
  background: transparent;
  pointer-events: none;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
}
.grid-cell--occupied {
  border-color: transparent;
}
.grid-cell--selected {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}
.grid-cell--drag-over {
  border-color: var(--success, #16a34a);
  background: color-mix(in srgb, var(--success, #16a34a) 18%, transparent);
}
.cell-add-btn {
  pointer-events: auto;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px dashed rgb(148 163 184 / 0.55);
  background: rgb(15 23 42 / 0.45);
  color: #cbd5e1;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 0.15s,
    transform 0.15s;
}
.comic-page--editable:hover .cell-add-btn {
  opacity: 0.75;
}
.cell-add-btn:hover {
  opacity: 1 !important;
  transform: scale(1.12);
  border-color: var(--accent);
  color: #fff;
  background: var(--accent);
}

.panel-hit {
  position: absolute;
  z-index: 2;
  pointer-events: none;
}
.panel-hit--selected {
  z-index: 6;
}
.panel-hit--framing {
  cursor: move;
}

.panel-order-badge {
  position: absolute;
  top: calc(6px * var(--inv-scale, 1));
  left: calc(6px * var(--inv-scale, 1));
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: 6px;
  background: rgb(15 23 42 / 0.78);
  color: #f8fafc;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: scale(var(--inv-scale, 1));
  transform-origin: top left;
  pointer-events: none;
}

.panel-empty-guide {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 12px;
  text-align: center;
  pointer-events: none;
}
.panel-empty-title {
  font-size: 13px;
  font-weight: 600;
  color: #475569;
}
.panel-empty-sub {
  font-size: 11px;
  color: #94a3b8;
}

.panel-floating-bar,
.bubble-floating-bar {
  position: absolute;
  bottom: calc(100% + 10px * var(--inv-scale, 1));
  left: 50%;
  transform: translateX(-50%) scale(var(--inv-scale, 1));
  transform-origin: center bottom;
  z-index: 25;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  white-space: nowrap;
  background: rgb(15 23 42 / 0.96);
  border: 1px solid rgb(255 255 255 / 0.2);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.45);
  backdrop-filter: blur(8px);
  pointer-events: auto;
}
.bubble-floating-bar {
  transform: translateX(-50%) rotate(var(--bubble-inv-rot, 0deg)) scale(var(--inv-scale, 1));
}
.pf-btn {
  height: 32px;
  padding: 0 12px;
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: #f8fafc;
  background: rgb(255 255 255 / 0.09);
  border: 1px solid rgb(255 255 255 / 0.08);
  border-radius: 7px;
  cursor: pointer;
  transition:
    background 0.15s,
    border-color 0.15s,
    transform 0.1s;
}
.pf-btn:hover {
  background: rgb(255 255 255 / 0.18);
  border-color: rgb(255 255 255 / 0.28);
}
.pf-btn:active {
  transform: scale(0.97);
}
.pf-btn--active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.pf-btn--danger:hover {
  background: var(--danger, #e11d48);
  border-color: var(--danger, #e11d48);
  color: #fff;
}

/* 分镜格大小调整手柄（保持屏幕固定尺寸，不随画布缩小时变小） */
.rs {
  position: absolute;
  z-index: 10;
  background: var(--accent);
  border: 1.5px solid #fff;
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.35);
  touch-action: none;
  pointer-events: auto;
}
.rs-r {
  right: 0;
  top: 50%;
  width: 9px;
  height: 32px;
  transform: translate(50%, -50%) scale(var(--inv-scale, 1));
  border-radius: 4px;
  cursor: ew-resize;
}
.rs-b {
  bottom: 0;
  left: 50%;
  width: 32px;
  height: 9px;
  transform: translate(-50%, 50%) scale(var(--inv-scale, 1));
  border-radius: 4px;
  cursor: ns-resize;
}
.rs-br {
  right: 0;
  bottom: 0;
  width: 15px;
  height: 15px;
  transform: translate(45%, 45%) scale(var(--inv-scale, 1));
  border-radius: 4px;
  cursor: nwse-resize;
}

/* 四角斜切顶点菱形控制点 */
.corner-slant-handle {
  position: absolute;
  z-index: 12;
  width: 13px;
  height: 13px;
  background: #f59e0b;
  border: 2px solid #fff;
  transform: translate(-50%, -50%) scale(var(--inv-scale, 1)) rotate(45deg);
  cursor: move;
  pointer-events: auto;
  box-shadow: 0 2px 6px rgb(0 0 0 / 0.4);
}
.corner-slant-handle:hover {
  background: #fbbf24;
  transform: translate(-50%, -50%) scale(calc(var(--inv-scale, 1) * 1.25)) rotate(45deg);
}

/* 集中线焦点准星 */
.focus-center-handle {
  position: absolute;
  z-index: 11;
  transform: translate(-50%, -50%) scale(var(--inv-scale, 1));
  font-size: 18px;
  cursor: move;
  pointer-events: auto;
  filter: drop-shadow(0 2px 4px rgb(0 0 0 / 0.5));
}

/* 选中气泡交互框 */
.bubble-selection-box {
  position: absolute;
  z-index: 15;
  outline: calc(2px * var(--inv-scale, 1)) solid var(--accent);
  outline-offset: calc(2px * var(--inv-scale, 1));
  border-radius: 6px;
  pointer-events: none;
}
.bubble-resize {
  position: absolute;
  right: 0;
  bottom: 0;
  z-index: 2;
  width: 16px;
  height: 16px;
  padding: 0;
  background: #fff;
  border: 2.5px solid var(--accent);
  border-radius: 50%;
  transform: translate(50%, 50%) scale(var(--inv-scale, 1));
  cursor: nwse-resize;
  pointer-events: auto;
  box-shadow: 0 2px 6px rgb(0 0 0 / 0.3);
}
.bubble-rotate-handle {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translate(-50%, calc(-100% - 8px * var(--inv-scale, 1))) scale(var(--inv-scale, 1));
  width: 15px;
  height: 15px;
  padding: 0;
  background: #38bdf8;
  border: 2px solid #fff;
  border-radius: 50%;
  cursor: grab;
  pointer-events: auto;
  box-shadow: 0 2px 6px rgb(0 0 0 / 0.3);
}

/* 气泡尾巴尖端自由拖拽控制柄 */
.bubble-tail-handle {
  position: absolute;
  z-index: 16;
  width: 14px;
  height: 14px;
  padding: 0;
  background: #f59e0b;
  border: 2px solid #fff;
  transform: translate(-50%, -50%) scale(var(--inv-scale, 1)) rotate(45deg);
  cursor: move;
  pointer-events: auto;
  box-shadow: 0 2px 6px rgb(0 0 0 / 0.45);
}
.bubble-tail-handle:hover {
  transform: translate(-50%, -50%) scale(calc(var(--inv-scale, 1) * 1.25)) rotate(45deg);
  background: #fbbf24;
}

.inline-bubble-editor {
  position: absolute;
  z-index: 28;
  transform: translate(-50%, -50%) scale(var(--inv-scale, 1));
  transform-origin: center center;
  min-width: 240px;
  max-width: 340px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  background: rgb(15 23 42 / 0.96);
  border: 1.5px solid var(--accent);
  border-radius: 10px;
  box-shadow: 0 10px 30px rgb(0 0 0 / 0.5);
}
.inline-speaker-input,
.inline-text-input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 10px;
  font-size: 13px;
  color: #f8fafc;
  background: rgb(30 41 59 / 0.9);
  border: 1px solid rgb(255 255 255 / 0.15);
  border-radius: 6px;
}
.inline-text-input {
  resize: vertical;
  line-height: 1.45;
}

.empty-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--text-muted);
}
</style>
