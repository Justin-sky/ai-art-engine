<template>
  <StudioFloatingWindow
    :open="open"
    :title="windowTitle"
    :z-index="1200"
    :default-width="1320"
    :default-height="860"
    :min-width="720"
    :min-height="560"
    body-class="pad-none"
    @close="onClose"
  >
    <div ref="rootEl" class="portrait-root" :style="{ '--portrait-panel-w': `${panelWidth}px` }">
      <!-- 顶：工具轨（横向，铺满整宽） -->
      <aside class="tool-rail">
        <button
          v-for="group in TOOL_GROUPS"
          :key="group.id"
          type="button"
          class="rail-item"
          :class="{ active: activeGroup === group.id, disabled: !groupEnabled(group) }"
          :title="groupTitle(group)"
          @click="selectGroup(group.id)"
        >
          <span class="rail-ico" aria-hidden="true">{{ group.icon }}</span>
          <span class="rail-label">{{ t(`graph.portrait.groups.${group.labelKey}`) }}</span>
          <span v-if="groupActiveCount(group.id)" class="rail-dot" aria-hidden="true" />
        </button>
      </aside>

      <!-- 左：原图（滚轮缩放 / Shift+滚轮、[ ] 旋转 / 空格、中键拖拽平移 / 双击复位） -->
      <section
        ref="stageEl"
        class="stage"
        :class="{
          'space-pan': spaceHeld && hasSource,
          panning: pan.active,
          drawing: activeGroup === 'region',
          'split-mode': splitDragSurface
        }"
        @wheel.prevent="onStageWheel"
        @pointerdown="onStagePointerDown"
        @dblclick.self="resetView"
      >
        <div v-if="sourceLoading" class="stage-empty">{{ t('graph.editor.loadingSource') }}</div>
        <div v-else-if="!sourceUrl" class="stage-empty">{{ t('graph.portrait.noSource') }}</div>
        <div v-else ref="wrapEl" class="canvas-wrap" @dblclick.self="resetView">
          <div class="canvas-stack" :style="canvasStackStyle">
            <img
              ref="imageEl"
              class="stage-img"
              :src="stageImageUrl"
              alt=""
              draggable="false"
              @pointerdown="onImagePointerDown"
              @pointermove="onImagePointerMove"
              @pointerup="onImagePointerUp"
              @pointercancel="onImagePointerUp"
              @pointerleave="onImagePointerUp"
              @contextmenu.prevent
            />
            <!-- 分割对比：左半压着原图（上游 / 所选版本前的底图），中缝可拖 -->
            <template v-if="splitActive">
              <img
                class="split-img"
                :src="upstreamUrl"
                :style="splitClipStyle"
                alt=""
                draggable="false"
              />
              <span class="split-tag left" :style="splitTagStyle">
                {{ t('graph.portrait.compareSideOriginal') }}
              </span>
              <span class="split-tag right" :style="splitTagStyle">
                {{ t('graph.portrait.compareSideCurrent') }}
              </span>
            </template>

            <!-- 手动区域框：归一化 0..1，直接就是发给模型的位置说明 -->
            <svg
              v-if="regionList.length || draftBox"
              class="region-layer"
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
            >
              <rect
                v-for="region in regionList"
                :key="region.id"
                :x="region.box?.x ?? 0"
                :y="region.box?.y ?? 0"
                :width="region.box?.w ?? 1"
                :height="region.box?.h ?? 1"
                :class="['region-box', `kind-${region.kind}`]"
              />
              <rect
                v-if="draftBox"
                :x="draftBox.x"
                :y="draftBox.y"
                :width="draftBox.w"
                :height="draftBox.h"
                class="region-box draft"
              />
            </svg>

            <!-- 中缝手柄：按住拖 = 移动分割线；方向键微调 -->
            <div
              v-if="splitActive"
              class="split-handle"
              :class="{ active: splitDragging }"
              :style="splitHandleStyle"
              role="separator"
              aria-orientation="vertical"
              :aria-valuenow="splitPercent"
              aria-valuemin="0"
              aria-valuemax="100"
              :title="t('graph.portrait.compareSplitHint')"
              tabindex="0"
              @pointerdown="onSplitPointerDown"
              @pointermove="onSplitPointerMove"
              @pointerup="onSplitPointerUp"
              @pointercancel="onSplitPointerUp"
              @keydown="onSplitKeydown"
            >
              <span class="split-grip" :style="splitGripStyle" aria-hidden="true">⇆</span>
            </div>

            <span v-if="activeGroup === 'region'" class="draw-hint">
              {{ t('graph.portrait.regionDrawHint') }}
            </span>
          </div>
        </div>

        <!-- 出图状态：窗口不关，进度就地显示，跑完左边这张图会换成产物 -->
        <div v-if="runRunning" class="stage-busy" role="status" aria-live="polite">
          <span class="spin" aria-hidden="true" />
          {{ t('graph.portrait.runRunning') }}
        </div>

        <div class="stage-bar">
          <span class="badge">{{ t('graph.portrait.sourceBadge') }}</span>
          <!-- 对比原图：按住看上游原图，松开回到当前底图（选了 AI 版本后才可比） -->
          <button
            v-if="upstreamUrl"
            type="button"
            class="bar-btn compare-btn"
            :class="{ active: compareHeld }"
            :disabled="!canCompare"
            :title="
              canCompare
                ? t('graph.portrait.compareHoldHint')
                : t('graph.portrait.compareUnavailable')
            "
            :aria-pressed="compareHeld"
            @pointerdown="onCompareDown"
            @pointerup="onCompareUp"
            @pointerleave="onCompareUp"
            @pointercancel="onCompareUp"
            @blur="onCompareUp"
            @keydown.space.prevent="onCompareDown"
            @keyup.space.prevent="onCompareUp"
          >
            ⇆ {{ compareHeld ? t('graph.portrait.compareShowing') : t('graph.portrait.compare') }}
          </button>
          <!-- 分割对比：切开画面，拖动中缝看原图与当前底图的差别 -->
          <button
            v-if="upstreamUrl"
            type="button"
            class="bar-btn compare-btn"
            :class="{ active: compareSplit }"
            :disabled="!canCompare"
            :title="
              canCompare
                ? t('graph.portrait.compareSplitHint')
                : t('graph.portrait.compareUnavailable')
            "
            :aria-pressed="compareSplit"
            @click="toggleCompareSplit"
          >
            ◐ {{ t('graph.portrait.compareSplit') }}
          </button>
          <span class="bar-info">{{ t('graph.portrait.viewHint') }}</span>
          <span class="bar-sep" />
          <span class="view-group">
            <button
              type="button"
              class="bar-btn view-btn"
              :title="t('graph.portrait.zoomOut')"
              :disabled="!hasSource"
              @click="zoomBy(1 / ZOOM_STEP)"
            >
              −
            </button>
            <button
              type="button"
              class="bar-btn view-level"
              :title="t('graph.portrait.zoomReset')"
              :disabled="!hasSource"
              @click="resetView"
            >
              {{ zoomPercent }}%
            </button>
            <button
              type="button"
              class="bar-btn view-btn"
              :title="t('graph.portrait.zoomIn')"
              :disabled="!hasSource"
              @click="zoomBy(ZOOM_STEP)"
            >
              +
            </button>
          </span>
          <span class="bar-sep" />
          <span class="view-group">
            <button
              type="button"
              class="bar-btn view-btn"
              :title="t('graph.portrait.rotateCcw')"
              :disabled="!hasSource"
              @click="rotateBy(-90)"
            >
              ⟲
            </button>
            <button
              type="button"
              class="bar-btn view-level"
              :title="t('graph.portrait.rotateReset')"
              :disabled="!hasSource"
              @click="resetRotation"
            >
              {{ rotationLabel }}
            </button>
            <button
              type="button"
              class="bar-btn view-btn"
              :title="t('graph.portrait.rotateCw')"
              :disabled="!hasSource"
              @click="rotateBy(90)"
            >
              ⟳
            </button>
          </span>
        </div>
      </section>

      <!-- 右：参数面板（左边缘可拖动改宽度；堆叠档下隐藏） -->
      <div
        v-if="resizable"
        ref="resizerEl"
        class="panel-resizer"
        :class="{ active: resizing }"
        role="separator"
        aria-orientation="vertical"
        :aria-valuenow="panelWidth"
        :aria-valuemin="PANEL_MIN_WIDTH"
        :aria-valuemax="PANEL_MAX_WIDTH"
        :title="t('graph.portrait.panelResizeHint')"
        tabindex="0"
        @pointerdown="onResizePointerDown"
        @pointermove="onResizePointerMove"
        @pointerup="onResizePointerUp"
        @pointercancel="onResizePointerUp"
        @keydown="onResizeKeydown"
      />
      <aside class="panel">
        <!-- 面板头：组名 + 重置（重置放最上面，属性区留给参数、底边留给出图） -->
        <div class="panel-head">
          <span class="panel-title">{{ t(`graph.portrait.groups.${activeGroupLabelKey}`) }}</span>
          <div class="panel-head-actions">
            <button type="button" class="ghost-btn tiny" @click="resetGroup">
              {{ t('graph.portrait.resetGroup') }}
            </button>
            <button type="button" class="ghost-btn tiny" @click="resetAll">
              {{ t('graph.portrait.reset') }}
            </button>
          </div>
        </div>

        <div class="panel-body">
          <p v-if="missingNeed(activeGroupMeta)" class="hint warn">
            {{ t(`graph.portrait.${needLabelKey(missingNeed(activeGroupMeta)!)}`) }}
          </p>

          <!-- 预设 -->
          <template v-if="activeGroup === 'preset'">
            <div class="preset-grid">
              <button
                v-for="preset in PORTRAIT_PRESETS"
                :key="preset.id"
                type="button"
                class="preset-btn"
                :class="{ active: draft.presetId === preset.id }"
                @click="applyPresetPreset(preset.id)"
              >
                {{ t(`graph.portrait.presets.${preset.labelKey}`) }}
              </button>
            </div>
            <div class="preset-io">
              <button type="button" class="ghost-btn" @click="exportPreset">
                {{ t('graph.portrait.exportPreset') }}
              </button>
              <button type="button" class="ghost-btn" @click="pickPresetFile">
                {{ t('graph.portrait.importPreset') }}
              </button>
              <input
                ref="presetFileEl"
                class="hidden-input"
                type="file"
                accept="application/json,.json"
                @change="onPresetFile"
              />
            </div>
            <p v-if="presetMessage" class="hint">{{ presetMessage }}</p>
            <p class="hint">{{ t('graph.portrait.presetHint') }}</p>
          </template>

          <!-- 手动区域 -->
          <template v-else-if="activeGroup === 'region'">
            <!-- 局部回贴：模型只认提示词、一次调用会重绘整图，勾上后按脸/人物/框的蒙版贴回 -->
            <label class="inline-check scope-check">
              <input
                type="checkbox"
                :checked="scopeMode === 'local'"
                @change="onScopeModeChange($event)"
              />
              <span>{{ t('graph.portrait.scopeLocal') }}</span>
            </label>
            <p class="hint">{{ t('graph.portrait.scopeLocalHint') }}</p>
            <p class="hint">{{ t('graph.portrait.regionHint') }}</p>
            <label class="row">
              <span class="row-label">{{ t('graph.portrait.regionKind') }}</span>
              <select v-model="activeRegionKind">
                <option v-for="kind in REGION_KINDS" :key="kind" :value="kind">
                  {{ t(`graph.portrait.regionKinds.${kind}`) }}
                </option>
              </select>
            </label>
            <div v-if="regionList.length" class="region-list">
              <div v-for="(region, index) in regionList" :key="region.id" class="region-row">
                <span class="region-index">{{ index + 1 }}</span>
                <span class="region-kind">{{
                  t(`graph.portrait.regionKinds.${region.kind}`)
                }}</span>
                <input
                  class="region-note"
                  type="text"
                  :value="region.note"
                  :placeholder="t('graph.portrait.regionNotePlaceholder')"
                  @input="onRegionNote(region.id, $event)"
                />
                <button type="button" class="ghost-btn tiny" @click="removeRegion(region.id)">
                  {{ t('graph.portrait.regionRemove') }}
                </button>
              </div>
            </div>
            <p v-else class="hint">{{ t('graph.portrait.regionEmpty') }}</p>
            <button v-if="regionList.length" type="button" class="ghost-btn" @click="clearRegions">
              {{ t('graph.portrait.regionClear') }}
            </button>
            <label class="row column">
              <span class="row-label">{{ t('graph.portrait.fields.extraNote') }}</span>
              <textarea
                v-model="draft.extraNote"
                class="text-area"
                rows="3"
                :placeholder="t('graph.portrait.placeholders.extraNote')"
                @change="pushHistory()"
              />
            </label>
          </template>

          <!-- AI 增强（编辑器内直调模型，结果作为版本存进节点） -->
          <template v-else-if="activeGroup === 'aiErase'">
            <p class="hint">{{ t('graph.portrait.aiHint') }}</p>
            <textarea
              v-model="aiPrompt"
              class="text-area"
              rows="2"
              :placeholder="t('graph.portrait.aiPromptPlaceholder')"
            />
            <div class="ai-actions">
              <button
                v-for="tool in AI_TOOLS"
                :key="tool.id"
                type="button"
                class="ghost-btn"
                :disabled="aiRunning || !sourceUrl"
                @click="runAi(tool.id)"
              >
                {{ t(`graph.portrait.${tool.labelKey}`) }}
              </button>
            </div>
            <p v-if="aiRunning" class="hint accent">{{ t('graph.portrait.aiRunning') }}</p>
            <p v-if="aiError" class="hint error">{{ aiError }}</p>
            <div v-if="layers.length" class="ai-history">
              <span class="row-label">{{ t('graph.portrait.aiHistory') }}</span>
              <button
                type="button"
                class="version-btn"
                :class="{ active: !baseLayerId }"
                @click="selectVersion('')"
              >
                {{ t('graph.portrait.aiBaseOriginal') }}
              </button>
              <button
                v-for="layer in layers"
                :key="layer.id"
                type="button"
                class="version-btn"
                :class="{ active: baseLayerId === layer.id }"
                :title="layer.prompt"
                @click="selectVersion(layer.id)"
              >
                {{ t(`graph.portrait.${AI_TOOL_LABEL_KEYS[layer.tool] ?? 'aiUpscale'}`) }}
              </button>
            </div>
          </template>

          <!-- 分段档位 / 选项 / 文本 / 数字 -->
          <template v-else>
            <div v-for="spec in groupSpecs" :key="spec.key" class="spec-block">
              <div class="spec-head">
                <span class="spec-label">{{ t(`graph.portrait.fields.${spec.labelKey}`) }}</span>
                <span v-if="spec.kind === 'tier' && spec.hintKey" class="spec-hint">
                  {{ t(`graph.portrait.hints.${spec.hintKey}`) }}
                </span>
              </div>

              <!-- 档位：分段按钮，无滑条 -->
              <div v-if="spec.kind === 'tier'" class="segmented">
                <button
                  v-for="tier in spec.tiers"
                  :key="tier"
                  type="button"
                  class="seg-btn"
                  :class="{ active: draft[spec.key] === tier, risk: isRisky(spec.key, tier) }"
                  @click="setTier(spec, tier)"
                >
                  {{ t(`graph.portrait.tiers.${tier}`) }}
                </button>
              </div>

              <!-- 具名选项 -->
              <select
                v-else-if="spec.kind === 'enum'"
                :value="draft[spec.key]"
                @change="onEnumChange(spec.key, $event)"
              >
                <option v-for="option in spec.options" :key="option" :value="option">
                  {{ optionLabel(option) }}
                </option>
              </select>

              <!-- 自由描述 -->
              <textarea
                v-else-if="spec.kind === 'text'"
                v-model="draft[spec.key]"
                class="text-area"
                rows="3"
                :placeholder="t(`graph.portrait.placeholders.${spec.placeholderKey}`)"
                @change="pushHistory()"
              />

              <input
                v-else-if="spec.kind === 'color'"
                :value="draft[spec.key]"
                type="color"
                @input="onColorInput(spec.key, $event)"
                @change="pushHistory()"
              />

              <input
                v-else-if="spec.kind === 'number'"
                v-model.number="draft[spec.key]"
                class="num-input"
                type="number"
                :min="spec.min"
                :max="spec.max"
                :step="spec.step"
                @change="pushHistory()"
              />

              <label v-else class="inline-check">
                <input
                  :checked="draft[spec.key]"
                  type="checkbox"
                  @change="onBoolChange(spec.key, $event)"
                />
                <span>{{ t('graph.portrait.enabled') }}</span>
              </label>

              <!-- 证件照规格说明 -->
              <p v-if="spec.key === 'idPhotoSpecId'" class="hint">
                {{ idPhotoSpecHint }}
              </p>
              <!-- 导出组说明：跟着规格块走，不要落到面板底部的动作行下面 -->
              <p v-if="spec.key === 'exportDpi'" class="hint">
                {{ t('graph.portrait.exportHint') }}
              </p>
            </div>
          </template>

          <!-- 提示词预览：参数区里的一个普通区块，不再是压着底边的一条 -->
          <section class="form-block prompt-block" :class="{ collapsed: promptCollapsed }">
            <div class="prompt-head">
              <span class="spec-label">{{ t('graph.portrait.promptPreview') }}</span>
              <span class="prompt-tools">
                <button type="button" class="ghost-btn tiny" @click="copyPrompt">
                  {{
                    promptCopied ? t('graph.portrait.promptCopied') : t('graph.portrait.promptCopy')
                  }}
                </button>
                <button
                  type="button"
                  class="ghost-btn tiny"
                  :aria-expanded="!promptCollapsed"
                  :title="t('graph.portrait.promptToggle')"
                  @click="togglePromptCollapsed"
                >
                  {{ promptCollapsed ? '▸' : '▾' }}
                </button>
              </span>
            </div>
            <textarea class="text-area prompt" rows="4" readonly :value="promptPreview" />
          </section>
        </div>

        <!-- 底部：生图模型 + 风险提示 + 保存并出图（贴住面板底边） -->
        <div class="panel-foot">
          <!-- 出图用哪张图片模型：选中即写回节点 generateModel，与节点参数同源 -->
          <ImageGenerateModelField
            ref="modelFieldEl"
            :open="open"
            :generate-model="generateModel"
            :generate-provider-instance-id="generateProviderInstanceId"
            @change="onModelChange"
          />
          <p v-if="runRunning" class="hint accent">{{ t('graph.portrait.runRunning') }}</p>
          <p v-else-if="runError" class="hint error">
            {{ t('graph.portrait.runFailed', { message: runError }) }}
          </p>
          <p v-else-if="riskCount" class="hint warn">
            {{ t('graph.portrait.riskWarning', { n: riskCount }) }}
          </p>
          <p v-else class="hint">{{ t('graph.portrait.riskOk') }}</p>
          <!-- 属性区域下方只剩「保存并出图」：跑图期间原地转进度，窗口不关 -->
          <div class="panel-actions">
            <button
              type="button"
              class="run-btn"
              :class="{ busy: runRunning }"
              :disabled="!sourceUrl || runRunning"
              @click="emitRun"
            >
              {{ runRunning ? t('graph.portrait.runRunning') : t('graph.portrait.runNode') }}
            </button>
          </div>
        </div>
      </aside>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  PORTRAIT_MANUAL_REGION_KINDS,
  PORTRAIT_PRESETS,
  PORTRAIT_TOOL_GROUPS,
  applyPortraitPreset,
  buildPortraitPrompt,
  defaultPortraitRetouch,
  exportPortraitPreset,
  idPhotoSpecById,
  importPortraitPreset,
  normalizePortraitManualRegions,
  normalizePortraitRetouch,
  portraitHighRiskTierCount,
  portraitSpecsForGroup,
  type PortraitAiLayer,
  type PortraitAiTool,
  type PortraitManualRegion,
  type PortraitManualRegionKind,
  type PortraitNeed,
  type PortraitParamSpec,
  type PortraitRetouchState,
  type PortraitToolGroup,
  type PortraitToolGroupId,
  type PortraitTierSpec
} from '@shared/graph'
import type { YoloTaskKind } from '@shared/yolo'
import { getYoloStatus } from '../features/yolo/api'
import { diveEditorHistory } from '../features/graph/ui/diveEditorHistory'
import { useStudioI18n } from '../composables/useStudioI18n'
import ImageGenerateModelField from './ImageGenerateModelField.vue'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    hostId?: string
    nodeId?: string
    setup?: Partial<PortraitRetouchState> | null
    regions?: PortraitManualRegion[]
    layers?: PortraitAiLayer[]
    baseLayerId?: string
    sourceUrl?: string
    /** 上游原图 URL：按住「对比原图」时切到它（与所选底图版本无关） */
    upstreamUrl?: string
    sourceLoading?: boolean
    generateModel?: string
    generateProviderInstanceId?: string
    /** 局部回贴开关：'local' = 只改对应部位（默认），'global' = 整图生效 */
    scopeMode?: 'local' | 'global'
    aiRunning?: boolean
    aiError?: string
    /** 「保存并出图」进行中：窗口不关，就地显示进度并把结果换到左边预览 */
    runRunning?: boolean
    /** 最近一次出图的失败原因（成功时清空） */
    runError?: string
  }>(),
  {
    hostId: '',
    nodeId: '',
    setup: null,
    regions: () => [],
    layers: () => [],
    baseLayerId: '',
    sourceUrl: '',
    upstreamUrl: '',
    sourceLoading: false,
    generateModel: '',
    generateProviderInstanceId: '',
    scopeMode: 'local',
    aiRunning: false,
    aiError: '',
    runRunning: false,
    runError: ''
  }
)

/** 编辑器写回宿主的载荷：档位参数 + 手动区域 (+ 模型选择 + 局部开关) */
interface PortraitEditorPayload {
  portraitRetouch: PortraitRetouchState
  manualRegions: PortraitManualRegion[]
  generateModel?: string
  generateProviderInstanceId?: string
  scopeMode?: 'local' | 'global'
}

const emit = defineEmits<{
  close: []
  update: [payload: PortraitEditorPayload]
  save: [payload: PortraitEditorPayload]
  /** 切底图版本（AI 版本栈） */
  'ai-version': [layerId: string]
  /** 保存并出图：载荷与 save 同一份，宿主落盘后关窗只跑这一个节点 */
  run: [payload: PortraitEditorPayload]
  ai: [
    payload: {
      tool: PortraitAiTool
      prompt: string
      model: string
      providerInstanceId: string
      sourceDataUrl: string
      maskDataUrl?: string
    }
  ]
}>()

const { t, te } = useStudioI18n()

const TOOL_GROUPS = PORTRAIT_TOOL_GROUPS
const REGION_KINDS = PORTRAIT_MANUAL_REGION_KINDS
const HISTORY_LIMIT = 40

const AI_TOOLS: Array<{ id: PortraitAiTool; labelKey: string }> = [
  { id: 'erase', labelKey: 'aiErase' },
  { id: 'background', labelKey: 'aiBackground' },
  { id: 'makeup', labelKey: 'aiMakeup' },
  { id: 'upscale', labelKey: 'aiUpscale' }
]
const AI_TOOL_LABEL_KEYS: Record<string, string> = {
  erase: 'aiErase',
  background: 'aiBackground',
  makeup: 'aiMakeup',
  upscale: 'aiUpscale',
  expand: 'aiUpscale',
  skinTexture: 'aiMakeup'
}

/** 档位按钮文案：全部走 `graph.portrait.tiers.<档位名>`（档位名即稳定令牌） */

const windowTitle = computed(() => t('graph.portrait.appMark'))

// ── 草稿状态 ───────────────────────────────────────────────────
const draft = reactive<PortraitRetouchState>(normalizePortraitRetouch())
const draftRegions = ref<PortraitManualRegion[]>([])
/**
 * 当前组用 `string` 而不是 `PortraitToolGroupId`：
 * 模板里 `activeGroup === 'preset'` 这类比较落在 Vue 的模板类型收窄上不稳定，
 * 用 string 承载、在真正需要字面量类型的地方（`portraitSpecsForGroup`）再断言。
 */
const activeGroup = ref<string>('skin')
const activeRegionKind = ref<PortraitManualRegionKind>('blemish')
const presetFileEl = ref<HTMLInputElement | null>(null)
const presetMessage = ref('')
const promptCopied = ref(false)
/** 提示词预览折叠态：默认展开，用户收起后记住到本次会话（属性区留给参数本身） */
const PROMPT_COLLAPSED_KEY = 'portrait.promptPreviewCollapsed'
const promptCollapsed = ref(false)
const aiPrompt = ref('')

try {
  promptCollapsed.value = window.localStorage.getItem(PROMPT_COLLAPSED_KEY) === '1'
} catch {
  /* 隐私模式 / 存储被禁用时保持默认展开 */
}

function togglePromptCollapsed(): void {
  promptCollapsed.value = !promptCollapsed.value
  try {
    window.localStorage.setItem(PROMPT_COLLAPSED_KEY, promptCollapsed.value ? '1' : '0')
  } catch {
    /* 记不住折叠态不影响功能 */
  }
}

// ── 参数面板宽度（画面 / 面板之间的拖动滑块）────────────────────
/**
 * 默认 360px，拖动范围 [PANEL_MIN_WIDTH, PANEL_MAX_WIDTH]。
 *
 * 只在并排档有意义：820px 以下网格会切成「画面在上、参数在下」，
 * 那时滑块的 `<aside>` 根本不在 DOM 里（v-if="resizable"），不会有隐身拖拽区。
 */
const PANEL_MIN_WIDTH = 300
const PANEL_MAX_WIDTH = 720
const PANEL_WIDTH_KEY = 'portrait.panelWidth'
const DEFAULT_PANEL_WIDTH = 360
const panelWidth = ref(DEFAULT_PANEL_WIDTH)

function clampPanelWidth(value: number): number {
  const max = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, window.innerWidth - 360))
  return Math.round(Math.min(max, Math.max(PANEL_MIN_WIDTH, value)))
}

try {
  const stored = Number(window.localStorage.getItem(PANEL_WIDTH_KEY))
  if (Number.isFinite(stored) && stored > 0) {
    panelWidth.value = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, stored))
  }
} catch {
  /* 记不住宽度不影响功能 */
}

function persistPanelWidth(): void {
  try {
    window.localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth.value))
  } catch {
    /* 同上 */
  }
}

/** 拖拽只在并排档有意义；窄到堆叠时滑块不存在 */
const resizable = ref(true)
const rootEl = ref<HTMLElement | null>(null)
const resizerEl = ref<HTMLElement | null>(null)
const resizing = ref(false)
const resizeStart = { x: 0, width: DEFAULT_PANEL_WIDTH }

function onResizePointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  event.preventDefault()
  resizing.value = true
  resizeStart.x = event.clientX
  resizeStart.width = panelWidth.value
  resizerEl.value?.setPointerCapture?.(event.pointerId)
}

function onResizePointerMove(event: PointerEvent): void {
  if (!resizing.value) return
  // 指针往左 = 面板变宽，所以是「起点减位移」
  panelWidth.value = clampPanelWidth(resizeStart.width - (event.clientX - resizeStart.x))
}

function onResizePointerUp(): void {
  if (!resizing.value) return
  resizing.value = false
  persistPanelWidth()
}

function onResizeKeydown(event: KeyboardEvent): void {
  const step = event.shiftKey ? 48 : 16
  if (event.key === 'ArrowLeft') panelWidth.value = clampPanelWidth(panelWidth.value + step)
  else if (event.key === 'ArrowRight') panelWidth.value = clampPanelWidth(panelWidth.value - step)
  else if (event.key === 'Home') panelWidth.value = PANEL_MIN_WIDTH
  else if (event.key === 'End') panelWidth.value = clampPanelWidth(PANEL_MAX_WIDTH)
  else return
  event.preventDefault()
  persistPanelWidth()
}

const imageEl = ref<HTMLImageElement | null>(null)
const stageEl = ref<HTMLElement | null>(null)
const wrapEl = ref<HTMLElement | null>(null)
const spaceHeld = ref(false)

const regionList = computed(() => draftRegions.value)
const layers = computed(() => props.layers ?? [])
const aiRunning = computed(() => props.aiRunning === true)
const aiError = computed(() => props.aiError ?? '')
const hasSource = computed(() => !!props.sourceUrl?.trim())

// ── 对比原图（按住看上游原图，松开回当前底图）────────────────────
/**
 * 上游原图由宿主解析（`upstreamUrl`）。当前底图就是上游原图时没有可比对象，
 * 此时按钮整体隐藏，不给用户一个点了没反应的控件。
 */
const upstreamUrl = computed(() => props.upstreamUrl?.trim() ?? '')
const canCompare = computed(
  () => !!upstreamUrl.value && upstreamUrl.value !== (props.sourceUrl?.trim() ?? '')
)
const compareHeld = ref(false)
const stageImageUrl = computed(() =>
  compareHeld.value && canCompare.value ? upstreamUrl.value : (props.sourceUrl ?? '')
)

function onCompareDown(): void {
  if (!canCompare.value) return
  compareHeld.value = true
}

function onCompareUp(): void {
  compareHeld.value = false
}

// ── 分割对比（切开画面，拖动中缝对比原图）──────────────────────
/**
 * 左半是上游原图（或所选 AI 版本之前的底图），右半是当前底图，中间一条可拖的分割线。
 *
 * 和「按住对比」是同一份 `canCompare` 判断：只有真的存在另一张图时才有意义，
 * 否则两边是同一张，拖了也看不出差别。
 */
const COMPARE_SPLIT_KEY = 'portrait.compareSplit'
const SPLIT_RATIO_KEY = 'portrait.splitRatio'
/** 两端各留一点：拉到 0 / 1 会把某一侧完全切掉，反而不好往回拖 */
const SPLIT_MIN = 0.02
const SPLIT_MAX = 0.98
const compareSplit = ref(false)
const splitRatio = ref(0.5)
const splitDragging = ref(false)

function clampSplitRatio(value: number): number {
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, value))
}

try {
  compareSplit.value = window.localStorage.getItem(COMPARE_SPLIT_KEY) === '1'
  const storedRatio = Number(window.localStorage.getItem(SPLIT_RATIO_KEY))
  if (Number.isFinite(storedRatio) && storedRatio > 0)
    splitRatio.value = clampSplitRatio(storedRatio)
} catch {
  /* 记不住对比偏好不影响功能 */
}

const splitActive = computed(() => compareSplit.value && canCompare.value)
/** 不在「区域」组时整张图都是拖动面；区域组里只认中缝手柄，免得抢掉画框手势 */
const splitDragSurface = computed(() => splitActive.value && activeGroup.value !== 'region')
const splitPercent = computed(() => Math.round(splitRatio.value * 100))
/**
 * 中缝与标签都在 `.canvas-stack` 里，跟着 `scale(zoom)` 一起被缩放 ——
 * 不反向缩放的话，放大到 400% 时这条 2px 细线会变成 8px 宽、手柄胀成一个圆饼。
 * UI 装饰应当与缩放无关，所以这里按 1/zoom 抵消。
 */
const splitCounterScale = computed(() => (zoom.value > 0 ? 1 / zoom.value : 1))
const splitHandleStyle = computed(() => ({
  left: `${splitRatio.value * 100}%`,
  transform: `translateX(-1px) scaleX(${splitCounterScale.value})`
}))
const splitTagStyle = computed(() => ({ transform: `scale(${splitCounterScale.value})` }))
const splitGripStyle = computed(() => ({
  transform: `translate(-50%, -50%) scale(${splitCounterScale.value})`
}))
/** 左侧压着原图，所以裁掉右边（1 - ratio） */
const splitClipStyle = computed(() => ({
  clipPath: `inset(0 ${(1 - splitRatio.value) * 100}% 0 0)`
}))

function persistSplitPrefs(): void {
  try {
    window.localStorage.setItem(COMPARE_SPLIT_KEY, compareSplit.value ? '1' : '0')
    window.localStorage.setItem(SPLIT_RATIO_KEY, String(splitRatio.value))
  } catch {
    /* 同上 */
  }
}

function toggleCompareSplit(): void {
  if (!canCompare.value) return
  compareSplit.value = !compareSplit.value
  persistSplitPrefs()
}

function onSplitPointerDown(event: PointerEvent): void {
  if (!splitActive.value || event.button !== 0) return
  event.preventDefault()
  // 别让画框 / 平移接管这一次拖拽
  event.stopPropagation()
  splitDragging.value = true
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  onSplitPointerMove(event)
}

/**
 * 拖动中缝：指针 → 图像归一化坐标走 `mapPointerToImage` 的视口逆变换，
 * 所以画面转过角度 / 缩放过之后，分割线依然落在指针底下（不用旋转后的外接框）。
 */
function onSplitPointerMove(event: PointerEvent): void {
  if (!splitDragging.value) return
  const point = mapPointerToImage(event)
  if (!point) return
  splitRatio.value = clampSplitRatio(point.x)
}

function onSplitPointerUp(): void {
  if (!splitDragging.value) return
  splitDragging.value = false
  persistSplitPrefs()
}

function onSplitKeydown(event: KeyboardEvent): void {
  const step = event.shiftKey ? 0.1 : 0.02
  if (event.key === 'ArrowLeft') splitRatio.value = clampSplitRatio(splitRatio.value - step)
  else if (event.key === 'ArrowRight') splitRatio.value = clampSplitRatio(splitRatio.value + step)
  else if (event.key === 'Home') splitRatio.value = SPLIT_MIN
  else if (event.key === 'End') splitRatio.value = SPLIT_MAX
  else return
  event.preventDefault()
  persistSplitPrefs()
}

// ── 视口（缩放 / 平移 / 视角旋转）──────────────────────────────
const ZOOM_MIN = 0.2
const ZOOM_MAX = 8
const ZOOM_STEP = 1.1
const zoom = ref(1)
const rotationDeg = ref(0)
const panOffset = reactive({ x: 0, y: 0 })
const pan = reactive({ active: false, startX: 0, startY: 0, originX: 0, originY: 0 })

let hydrating = false
let unregisterHistory: (() => void) | null = null
let sizeObserver: ResizeObserver | null = null
let updateTimer: ReturnType<typeof setTimeout> | null = null

const history = ref<Array<{ state: PortraitRetouchState; regions: PortraitManualRegion[] }>>([])
const historyIndex = ref(-1)

const activeGroupMeta = computed<PortraitToolGroup | undefined>(() =>
  TOOL_GROUPS.find((group) => group.id === activeGroup.value)
)
const activeGroupLabelKey = computed(() => activeGroupMeta.value?.labelKey ?? 'skin')
const groupSpecs = computed<PortraitParamSpec[]>(() =>
  portraitSpecsForGroup(activeGroup.value as PortraitToolGroupId)
)
const riskCount = computed(() => portraitHighRiskTierCount(draft))

const idPhotoSpecHint = computed(() => {
  const spec = idPhotoSpecById(draft.idPhotoSpecId)
  if (!spec) return t('graph.portrait.idPhotoOff')
  return t('graph.portrait.idPhotoSpecHint', {
    w: spec.widthMm,
    h: spec.heightMm,
    mm: `${spec.widthMm}×${spec.heightMm}mm`
  })
})

/** 提示词预览：与执行器同一份合成函数，用户看到的就是模型会收到的东西 */
const promptPreview = computed(() => {
  const spec = idPhotoSpecById(draft.idPhotoSpecId)
  const prompt = buildPortraitPrompt({
    state: draft,
    // 编辑器里无法确定运行时依赖是否齐备，按「都可用」预览；执行器会按实际情况裁剪
    needs: { face: true, mask: true, pose: true },
    idPhoto: spec
      ? {
          label: t(`graph.portrait.options.${spec.labelKey}`),
          widthMm: spec.widthMm,
          heightMm: spec.heightMm,
          background: t(`graph.portrait.options.${draft.idPhotoBg}`),
          sheet: draft.idPhotoSheet
        }
      : null
  })
  return prompt.negative
    ? `${prompt.main}\n\n${t('graph.portrait.negativePreview')}：${prompt.negative}`
    : prompt.main
})

// ── 依赖门禁 ───────────────────────────────────────────────────
const yoloKinds = ref<YoloTaskKind[] | null>(null)

async function loadYoloKinds(): Promise<void> {
  try {
    const status = await getYoloStatus()
    yoloKinds.value = status.models.map((model) => model.kind)
  } catch {
    yoloKinds.value = null
  }
}

function missingNeed(group: PortraitToolGroup | undefined): PortraitNeed | null {
  if (!group?.needs?.length) return null
  // 查询失败（null）时不置灰：宁可让用户试，也不要因为一次查询失败锁住功能
  if (!yoloKinds.value) return null
  for (const need of group.needs) {
    const kind: YoloTaskKind = need === 'face' ? 'face' : need === 'pose' ? 'pose' : 'segment'
    if (!yoloKinds.value.includes(kind)) return need
  }
  return null
}

function groupEnabled(group: PortraitToolGroup): boolean {
  return missingNeed(group) === null
}

function needLabelKey(need: PortraitNeed): string {
  return need === 'face' ? 'faceMissing' : need === 'pose' ? 'poseMissing' : 'maskMissing'
}

function groupTitle(group: PortraitToolGroup): string {
  const label = t(`graph.portrait.groups.${group.labelKey}`)
  const missing = missingNeed(group)
  return missing ? `${label} · ${t(`graph.portrait.${needLabelKey(missing)}`)}` : label
}

function groupActiveCount(groupId: string): number {
  if (groupId === 'region') return draftRegions.value.length
  let count = 0
  for (const spec of portraitSpecsForGroup(groupId as PortraitToolGroupId)) {
    if ((draft as unknown as Record<string, unknown>)[spec.key] !== specDefaultOf(spec)) count++
  }
  return count
}

function specDefaultOf(spec: PortraitParamSpec): unknown {
  return spec.kind === 'tier'
    ? 'off'
    : spec.kind === 'text'
      ? ''
      : (spec as { default: unknown }).default
}

function selectGroup(groupId: string): void {
  activeGroup.value = groupId
}

// ── 视口变换 ───────────────────────────────────────────────────
const zoomPercent = computed(() => Math.round(zoom.value * 100))
const rotationLabel = computed(() => `${Math.round(rotationDeg.value)}°`)
const canvasStackStyle = computed(() => ({
  transform: `translate(${panOffset.x}px, ${panOffset.y}px) rotate(${rotationDeg.value}deg) scale(${zoom.value})`
}))

function zoomBy(factor: number): void {
  zoom.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom.value * factor))
}

function rotateBy(deg: number): void {
  rotationDeg.value = (rotationDeg.value + deg) % 360
}

function resetRotation(): void {
  rotationDeg.value = 0
}

function resetView(): void {
  zoom.value = 1
  rotationDeg.value = 0
  panOffset.x = 0
  panOffset.y = 0
}

function onStageWheel(event: WheelEvent): void {
  if (event.shiftKey) {
    rotateBy(event.deltaY > 0 ? ROTATE_STEP : -ROTATE_STEP)
    return
  }
  zoomBy(event.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP)
}

const ROTATE_STEP = 15

function onStagePointerDown(event: PointerEvent): void {
  if (event.button === 1 || spaceHeld.value) {
    pan.active = true
    pan.startX = event.clientX
    pan.startY = event.clientY
    pan.originX = panOffset.x
    pan.originY = panOffset.y
    ;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
  }
}

function onStagePointerMove(event: PointerEvent): void {
  if (!pan.active) return
  panOffset.x = pan.originX + (event.clientX - pan.startX)
  panOffset.y = pan.originY + (event.clientY - pan.startY)
}

function onStagePointerUp(): void {
  pan.active = false
}

// ── 手动区域绘制（归一化框，直接是发给模型的位置说明）────────────
const drawing = reactive({ active: false, startX: 0, startY: 0, x: 0, y: 0, w: 0, h: 0 })

/**
 * 当前草稿框（归一化 0..1），松手时也用它算最终框。
 *
 * ⚠️ 这里刻意做成普通函数、**不在 computed 里判 `drawing.active`**：
 * 松手那一步是「先取框、再清 active」，而早先的写法是
 * `computed(() => drawing.active ? {…} : null)` + 先清 active 再读 computed ——
 * 读到的永远是 null，于是每次画完都被当成「框太小」丢掉，
 * 表现就是「区域怎么拖都画不出来」。
 */
function currentDraftBox(): { x: number; y: number; w: number; h: number } | null {
  if (!drawing.active) return null
  return {
    x: Math.min(drawing.startX, drawing.x),
    y: Math.min(drawing.startY, drawing.y),
    w: Math.abs(drawing.x - drawing.startX),
    h: Math.abs(drawing.y - drawing.startY)
  }
}

const draftBox = computed(() => currentDraftBox())

/**
 * 指针 → 图像归一化坐标。
 *
 * 不能直接用 `getBoundingClientRect()`：叠了 `rotate(...)` 之后它返回的是**旋转后的外接框**，
 * 不是图像本身的四边形，于是「转个角度之后区域框落点整体偏掉」。
 * 这里把指针在视口坐标系里逆变换回未变换的图像，再按**自然尺寸**归一化：
 * 外接框在缩放 / 旋转之后已经不是图像本身的大小，拿它当分母会整体偏移。
 * 平移也已经在 rect 里（变换挂在这个 img 的父层上），不能再减一次。
 */
function mapPointerToImage(event: PointerEvent): { x: number; y: number } | null {
  const img = imageEl.value
  if (!img) return null
  const imageRect = img.getBoundingClientRect()
  if (imageRect.width <= 0 || imageRect.height <= 0) return null
  const naturalW = img.naturalWidth || imageRect.width
  const naturalH = img.naturalHeight || imageRect.height
  if (naturalW <= 0 || naturalH <= 0) return null

  // 指针相对「图像视觉中心」的位移（外接框的中心就是旋转中心）
  const x = event.clientX - (imageRect.left + imageRect.width / 2)
  const y = event.clientY - (imageRect.top + imageRect.height / 2)
  const rad = (rotationDeg.value * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const scale = zoom.value || 1
  // 逆变换：先反旋转、再反缩放，得到未变换图像上的像素偏移
  const localX = (x * cos + y * sin) / scale
  const localY = (-x * sin + y * cos) / scale

  return {
    x: Math.min(1, Math.max(0, localX / naturalW + 0.5)),
    y: Math.min(1, Math.max(0, localY / naturalH + 0.5))
  }
}

function onImagePointerDown(event: PointerEvent): void {
  // 空格 / 中键是平移手势：放行给 stage，别被分割线抢走
  if (spaceHeld.value) return
  // 分割对比开着时，图面本身就是拖动面（区域组除外：那里以画框为主，中缝只认手柄）
  if (splitDragSurface.value) {
    onSplitPointerDown(event)
    return
  }
  if (activeGroup.value !== 'region' || event.button !== 0) return
  const point = mapPointerToImage(event)
  if (!point) return
  event.preventDefault()
  drawing.active = true
  drawing.startX = point.x
  drawing.startY = point.y
  drawing.x = point.x
  drawing.y = point.y
  imageEl.value?.setPointerCapture?.(event.pointerId)
}

function onImagePointerMove(event: PointerEvent): void {
  if (!drawing.active) return
  const point = mapPointerToImage(event)
  if (!point) return
  drawing.x = point.x
  drawing.y = point.y
}

function onImagePointerUp(): void {
  onSplitPointerUp()
  if (!drawing.active) return
  // 先取框再清 active —— 顺序反了框就没了（见 currentDraftBox 注释）
  const box = currentDraftBox()
  drawing.active = false
  if (!box || box.w < 0.01 || box.h < 0.01) return
  draftRegions.value = normalizePortraitManualRegions([
    ...draftRegions.value,
    {
      id: `region-${Date.now().toString(36)}`,
      kind: activeRegionKind.value,
      box,
      note: ''
    }
  ])
  pushHistory()
}

function onRegionNote(id: string, event: Event): void {
  const value = (event.target as HTMLInputElement).value
  draftRegions.value = draftRegions.value.map((region) =>
    region.id === id ? { ...region, note: value } : region
  )
}

function removeRegion(id: string): void {
  draftRegions.value = draftRegions.value.filter((region) => region.id !== id)
  pushHistory()
}

function clearRegions(): void {
  draftRegions.value = []
  pushHistory()
}

// ── 参数编辑 ───────────────────────────────────────────────────
const RISK_TIERS = new Set(['strong', 'max'])
/** 身份保真风险较高的形态类字段：推到 strong/max 时按钮上给个提示色 */
const RISK_FIELDS = new Set([
  'faceSlim',
  'jawline',
  'chin',
  'eyeSize',
  'noseShape',
  'lipShape',
  'waistSlim',
  'shoulderNeck',
  'legLengthen'
])

function isRisky(key: string, tier: string): boolean {
  return RISK_FIELDS.has(key) && RISK_TIERS.has(tier)
}

function setTier(spec: PortraitTierSpec, tier: string): void {
  ;(draft as unknown as Record<string, string>)[spec.key] = tier
  draft.presetId = ''
  pushHistory()
}

function onEnumChange(key: string, event: Event): void {
  ;(draft as unknown as Record<string, string>)[key] = (event.target as HTMLSelectElement).value
  draft.presetId = ''
  pushHistory()
}

function onColorInput(key: string, event: Event): void {
  ;(draft as unknown as Record<string, string>)[key] = (event.target as HTMLInputElement).value
  scheduleUpdate()
}

function onBoolChange(key: string, event: Event): void {
  ;(draft as unknown as Record<string, boolean>)[key] = (event.target as HTMLInputElement).checked
  pushHistory()
}

/** 局部回贴开关：即时写回宿主（与模型选择同一套口径） */
function onScopeModeChange(event: Event): void {
  const local = (event.target as HTMLInputElement).checked
  emit('update', { ...buildPayload(), scopeMode: local ? 'local' : 'global' })
}

/**
 * 枚举 / 具名选项的显示文案：统一走 `graph.portrait.options.<选项值>`（选项值即稳定令牌）。
 *
 * 用 `te()` 探测而不是维护「哪些字段要翻译」的白名单 —— 白名单漏登记一个字段的表现是
 * 下拉框里显示 `oneInch` 这种裸令牌，既不报错也不显眼（证件照规格就这么漏过一次）。
 * 真的没有对应文案的值（如自定义色值）原样显示。
 */
function optionLabel(option: string): string {
  const key = `graph.portrait.options.${option}`
  return te(key) ? String(t(key)) : option
}

function applyPresetPreset(presetId: string): void {
  Object.assign(draft, applyPortraitPreset(presetId))
  pushHistory()
}

function resetGroup(): void {
  const defaults = defaultPortraitRetouch() as unknown as Record<string, unknown>
  for (const spec of groupSpecs.value) {
    ;(draft as unknown as Record<string, unknown>)[spec.key] = defaults[spec.key]
  }
  if (activeGroup.value === 'region') draftRegions.value = []
  draft.presetId = ''
  pushHistory()
}

function resetAll(): void {
  Object.assign(draft, defaultPortraitRetouch())
  draftRegions.value = []
  pushHistory()
}

// ── 草稿级撤销 / 重做 ─────────────────────────────────────────
function snapshot(): { state: PortraitRetouchState; regions: PortraitManualRegion[] } {
  return {
    state: { ...normalizePortraitRetouch(draft) },
    regions: draftRegions.value.map((region) => ({
      ...region,
      box: region.box ? { ...region.box } : null
    }))
  }
}

function pushHistory(): void {
  if (hydrating) return
  const entry = snapshot()
  const current = history.value[historyIndex.value]
  if (current && JSON.stringify(current) === JSON.stringify(entry)) return
  history.value = [...history.value.slice(0, historyIndex.value + 1), entry].slice(-HISTORY_LIMIT)
  historyIndex.value = history.value.length - 1
  emitUpdate()
}

function applySnapshot(entry: {
  state: PortraitRetouchState
  regions: PortraitManualRegion[]
}): void {
  hydrating = true
  Object.assign(draft, normalizePortraitRetouch(entry.state))
  draftRegions.value = entry.regions.map((region) => ({
    ...region,
    box: region.box ? { ...region.box } : null
  }))
  void nextTick(() => {
    hydrating = false
    emitUpdate()
  })
}

function undo(): void {
  if (historyIndex.value <= 0) return
  historyIndex.value -= 1
  applySnapshot(history.value[historyIndex.value]!)
}

function redo(): void {
  if (historyIndex.value >= history.value.length - 1) return
  historyIndex.value += 1
  applySnapshot(history.value[historyIndex.value]!)
}

// ── 生图模型选择（「保存并出图」用哪张图片模型）──────────────────
const modelFieldEl = ref<{
  currentSelection: () => { generateModel: string; generateProviderInstanceId: string }
} | null>(null)
const modelDraft = reactive({
  generateModel: '',
  generateProviderInstanceId: ''
})
/**
 * 子组件挂载后会自己解析一次默认模型并 `change` 一次 —— 那一次只用来填草稿，
 * 不算用户的选择（否则「打开面板再关掉」也会给节点钉上一个模型）。
 * 本组件每次开窗都是新实例，所以首个 change 事件就是这次解析。
 */
let modelResolving = true

/** 当前下拉里选中的模型：以子组件的实时选择为准，载荷与 AI 调用都用它 */
function currentModelSelection(): { generateModel: string; generateProviderInstanceId: string } {
  const fromField = modelFieldEl.value?.currentSelection()
  if (fromField?.generateModel || fromField?.generateProviderInstanceId) return fromField
  // 选项还没解析出来（或节点上的模型已不在选项里）时不要写空值：
  // 退回节点当前值，免得改个档位就顺手把已选模型抹掉
  if (modelDraft.generateModel || modelDraft.generateProviderInstanceId) return { ...modelDraft }
  return {
    generateModel: props.generateModel ?? '',
    generateProviderInstanceId: props.generateProviderInstanceId ?? ''
  }
}

function onModelChange(payload: {
  generateModel: string
  generateProviderInstanceId: string
}): void {
  const resolving = modelResolving
  modelResolving = false
  modelDraft.generateModel = payload.generateModel
  modelDraft.generateProviderInstanceId = payload.generateProviderInstanceId
  if (resolving) return
  // 与已落盘的选择一致（宿主回灌 props）时不用再写一次
  if (
    payload.generateModel === (props.generateModel ?? '') &&
    payload.generateProviderInstanceId === (props.generateProviderInstanceId ?? '')
  ) {
    return
  }
  // 与参数同一套口径：改完即时写回节点，免得关窗 / 面包屑回退时丢掉模型选择
  scheduleUpdate()
}

// ── 写回宿主 ───────────────────────────────────────────────────
function buildPayload(): PortraitEditorPayload {
  const model = currentModelSelection()
  return {
    portraitRetouch: normalizePortraitRetouch(draft),
    manualRegions: normalizePortraitManualRegions(draftRegions.value),
    generateModel: model.generateModel,
    generateProviderInstanceId: model.generateProviderInstanceId,
    scopeMode: props.scopeMode === 'global' ? 'global' : 'local'
  }
}

function scheduleUpdate(): void {
  if (!props.open || hydrating) return
  if (updateTimer) clearTimeout(updateTimer)
  updateTimer = setTimeout(() => {
    updateTimer = null
    emitUpdate()
  }, 48)
}

function emitUpdate(): void {
  emit('update', buildPayload())
}

function emitRun(): void {
  /**
   * 「保存并出图」= 落盘参数 + 只跑这个节点，两件事由宿主 `runPortrait` 一次做完
   * （它自己会 `applyPortraitParams` + 记撤销命令 + 跑图，跑完把产物换到左边预览）。
   *
   * ⚠️ 两点都不能回退：
   * 1. 不能先 `emit('save')`：那一发会立刻关窗并清空 `portrait.nodeId`，
   *    紧接着的 run 在宿主里找不到节点就静默返回 —— 表现是「窗口关了但没出图」。
   * 2. 窗口要一直开着：用户在原地看进度与失败原因，不该被弹回上一级。
   */
  if (props.runRunning) return
  emit('run', buildPayload())
}

const dirty = computed(() => {
  const before = normalizePortraitRetouch(props.setup)
  const after = normalizePortraitRetouch(draft)
  if (JSON.stringify(before) !== JSON.stringify(after)) return true
  return (
    JSON.stringify(normalizePortraitManualRegions(props.regions)) !==
    JSON.stringify(normalizePortraitManualRegions(draftRegions.value))
  )
})

function onClose(): void {
  if (dirty.value) emit('save', buildPayload())
  emit('close')
}

// ── 预设导入导出 ───────────────────────────────────────────────
function exportPreset(): void {
  try {
    const text = exportPortraitPreset(t('graph.portrait.appMark'), draft)
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${t('graph.portrait.appMark')}-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    presetMessage.value = err instanceof Error ? err.message : String(err)
  }
}

function pickPresetFile(): void {
  presetFileEl.value?.click()
}

async function onPresetFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const parsed = importPortraitPreset(await file.text())
  if (!parsed.ok) {
    presetMessage.value =
      parsed.reason === 'invalid-json'
        ? t('graph.portrait.presetImportInvalid')
        : parsed.reason === 'not-preset'
          ? t('graph.portrait.presetImportNotPreset')
          : t('graph.portrait.presetImportVersion')
    return
  }
  Object.assign(draft, parsed.state)
  presetMessage.value = t('graph.portrait.presetImported', { name: parsed.name })
  pushHistory()
}

// ── 提示词复制 ─────────────────────────────────────────────────
async function copyPrompt(): Promise<void> {
  try {
    await navigator.clipboard.writeText(promptPreview.value)
    promptCopied.value = true
    setTimeout(() => {
      promptCopied.value = false
    }, 1200)
  } catch {
    /* 剪贴板不可用时保持原文可手动选择 */
  }
}

// ── AI 增强 ────────────────────────────────────────────────────
function runAi(tool: PortraitAiTool): void {
  const source = props.sourceUrl?.trim()
  if (!source) return
  const model = currentModelSelection()
  emit('ai', {
    tool,
    prompt: aiPrompt.value,
    model: model.generateModel,
    providerInstanceId: model.generateProviderInstanceId,
    sourceDataUrl: source
  })
}

function selectVersion(layerId: string): void {
  emit('ai-version', layerId)
}

// ── 生命周期 ───────────────────────────────────────────────────
function hydrate(): void {
  hydrating = true
  Object.assign(draft, normalizePortraitRetouch(props.setup))
  draftRegions.value = normalizePortraitManualRegions(props.regions)
  presetMessage.value = ''
  aiPrompt.value = ''
  history.value = [snapshot()]
  historyIndex.value = 0
  resetView()
  void nextTick(() => {
    hydrating = false
  })
}

function onKeyDown(event: KeyboardEvent): void {
  if (!props.open) return
  const target = event.target as HTMLElement | null
  const typing =
    target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT'
  if (event.code === 'Space' && !typing) {
    spaceHeld.value = true
  }
  if (typing) return
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey) redo()
    else undo()
    return
  }
  if (event.ctrlKey || event.metaKey) return
  if (event.key === '[') rotateBy(-ROTATE_STEP)
  else if (event.key === ']') rotateBy(ROTATE_STEP)
  else if (event.key === '0') resetView()
}

function onKeyUp(event: KeyboardEvent): void {
  if (event.code === 'Space') spaceHeld.value = false
}

function onWindowPointerMove(event: PointerEvent): void {
  onStagePointerMove(event)
  onResizePointerMove(event)
  // 指针移出中缝 / 图片也不断：拖动中缝同样走窗口级监听
  onSplitPointerMove(event)
}

function onWindowPointerUp(): void {
  onStagePointerUp()
  onResizePointerUp()
  onSplitPointerUp()
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('pointermove', onWindowPointerMove)
  window.addEventListener('pointerup', onWindowPointerUp)
  void loadYoloKinds()
  // 与 CSS 的 @container 阈值保持一致：容器窄到堆叠档时滑块必须消失
  if (rootEl.value && typeof ResizeObserver !== 'undefined') {
    sizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      resizable.value = width > 820
    })
    sizeObserver.observe(rootEl.value)
    resizable.value = rootEl.value.clientWidth > 820
  }
  unregisterHistory = diveEditorHistory.register({
    canUndo: () => historyIndex.value > 0,
    canRedo: () => historyIndex.value < history.value.length - 1,
    undo,
    redo
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('pointermove', onWindowPointerMove)
  window.removeEventListener('pointerup', onWindowPointerUp)
  sizeObserver?.disconnect()
  sizeObserver = null
  if (updateTimer) clearTimeout(updateTimer)
  unregisterHistory?.()
  unregisterHistory = null
})

watch(
  () => props.open,
  (open) => {
    if (open) hydrate()
  },
  { immediate: true }
)

watch(
  () => props.setup,
  (value, previous) => {
    if (hydrating || !props.open) return
    // 宿主从外部改了参数（撤销 / MCP / 换版本）才重新灌入草稿
    if (JSON.stringify(value) === JSON.stringify(previous)) return
    hydrate()
  }
)
</script>

<style scoped>
.portrait-root {
  display: grid;
  /**
   * 三列布局：工具轨 / 画面 / 参数面板。
   *
   * ⚠️ `flex-basis: 0` 是必须的，不是保险：
   * 宿主 `StudioFloatingWindow` 的 `.sfw-body.pad-none > *` 会给这个 slot 子元素
   * `flex: 1 1 auto`，而 **`flex-basis: auto` 作用在 grid 容器上会解析为它的 max-content 宽度** ——
   * 于是网格按「各列 max-content」撑开，写死的面板列被无视，面板被压成一字一行。
   * `width: 100%` 是同一件事的显式兜底（在 `flex-column` 下 `flex-basis` 管高度，不管宽度）。
   */
  flex: 1 1 0%;
  width: 100%;
  /**
   * 画面列带下限：`minmax(300px, 1fr)`。
   *
   * 只写 `minmax(0, 1fr)` 时画面列可以被压到 0——真实场景里宿主给了多少宽度就用多少，
   * 窄窗口下画面会先在参数面板之前塌掉，表现就是「图没了」。给一个下限后由下面的
   * @container 接管降级。
   * 面板列走 `--portrait-panel-w`（默认 360px，由拖动滑块写入）：宽度是运行时状态，
   * 不再是网格里的常量，所以用 CSS 变量而不是硬编码值。
   */
  --portrait-panel-w: 360px;
  grid-template-columns: auto 6px minmax(300px, 1fr) var(--portrait-panel-w);
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  container-type: inline-size;
}

.portrait-root > * {
  min-width: 0;
  min-height: 0;
}

/**
 * ⚠️ 三列（现在是四轨）的**显式落位**是必须的，不是保险。
 *
 * `.tool-rail` 声明了 `grid-column: 1 / -1`，但容器被 `container-type` 变成容器后
 * 各项的自动放置顺序会按「已声明列」重新排：只给工具轨写了列，后面的 stage / panel
 * 就会顺着「下一个可用格」落到第 1、2 列 —— 实测面板因此落在第 2 列（宽 320），
 * 面板该在的那一列整列空着，表现就是「参数面板右边多出一大块空白」。
 * 所以每一轨都必须显式写死列号：画面 = 3 列、拖动条 = 2 列、面板 = 4 列。
 */
.stage {
  grid-column: 3;
  grid-row: 2;
}

.panel {
  grid-column: 4;
  grid-row: 2;
}

/**
 * 参数面板左边缘的拖动滑块（画面 ↔ 参数的分隔条）。
 *
 * 单独占一条 2 列 6px 的轨道，拖动改的是 `--portrait-panel-w`（面板列宽），
 * 画面列是 `1fr`，自动吃掉差额。命中区比视觉线宽（4px），方便点中。
 */
.panel-resizer {
  grid-column: 2;
  grid-row: 2;
  position: relative;
  z-index: 2;
  cursor: col-resize;
  background: transparent;
  touch-action: none;
  outline: none;
}

.panel-resizer::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 4px;
  transform: translateX(-50%);
  background: transparent;
}

.panel-resizer:hover::after,
.panel-resizer.active::after,
.panel-resizer:focus-visible::after {
  background: color-mix(in srgb, var(--accent) 60%, transparent);
}

/**
 * 中窄兜底（第一档）：并排但把面板收紧到 300px，把宽度让给画面。
 * 阈值 1180px：再宽就该给面板完整宽度，再窄则由下面第二档接管。
 */
@container (max-width: 1180px) {
  .portrait-root {
    grid-template-columns: auto 6px minmax(260px, 1fr) 300px;
  }
}

/**
 * 窄兜底（第二档）：改成「画面在上、参数在下」的两行堆叠。
 *
 * ⚠️ 阈值必须 **大于**「画面下限 + 面板下限」（260 + 300 = 560）并留出余量。
 * 这里取 820px：低于它再并排，两个下限之和已经超过可用宽度，
 * 网格会强行压缩轨道 —— 表现就是画面先塌掉、参数面板被挤成一字一行
 * （HiDPI 笔记本把窗口分屏到 ~700px 宽时就会踩到）。
 *
 * ⚠️ 堆叠后只剩一列，必须把 `.stage` / `.panel` 的基础 `grid-column` 改回第 1 列，
 * 否则它们会落在一个不存在的列上（网格会自动补列，宽度直接失控）。
 */
@container (max-width: 820px) {
  .portrait-root {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(220px, 1fr) minmax(0, 1fr);
  }

  .stage {
    grid-column: 1;
    grid-row: 2;
  }

  .tool-rail {
    grid-column: 1;
    grid-row: 1;
  }

  .panel {
    grid-column: 1;
    grid-row: 3;
    border-left: none;
    border-top: 1px solid var(--border);
  }

  /* 堆叠后左右关系不存在，拖动条没有意义（模板里也已经被 v-if 摘掉） */
  .panel-resizer {
    display: none;
  }
}

.tool-rail {
  grid-column: 1 / -1;
  display: flex;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
}

.rail-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
  /* 工具轨整体横向滚动，单个按钮不参与压缩（压缩会让图标与文字错行） */
  flex: 0 0 auto;
}

.rail-item.active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}

.rail-item.disabled {
  opacity: 0.45;
}

.rail-dot {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
}

.stage {
  position: relative;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-sunken, #14161a);
  overflow: hidden;
}

.stage.drawing {
  cursor: crosshair;
}

.stage-empty {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--text-muted);
  font-size: 12px;
}

.canvas-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px;
  overflow: hidden;
}

/**
 * 画面栈：刻意用 flex + `max-width/height: 100%` 而不是 grid 的 `place-items: center`。
 * grid 会把子项按内容尺寸放置，于是 `max-height: 100%` 的参照是「内容高度」——
 * 图片永远保持原始尺寸，不会放大占满舞台（表现就是「图很小、留白很大」）。
 */
.canvas-stack {
  position: relative;
  display: flex;
  max-width: 100%;
  max-height: 100%;
  min-width: 0;
  min-height: 0;
  transform-origin: center center;
}

.stage-img {
  display: block;
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  user-select: none;
  /* 触摸 / 手写笔拖动要自己接管，否则浏览器会当成滚动手势发 pointercancel，画框直接断掉 */
  touch-action: none;
}

.region-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.region-box {
  fill: rgba(56, 189, 248, 0.12);
  stroke: rgba(56, 189, 248, 0.9);
  stroke-width: 0.004;
}

.region-box.kind-blemish {
  stroke: rgba(248, 113, 113, 0.95);
  fill: rgba(248, 113, 113, 0.12);
}
.region-box.kind-skin {
  stroke: rgba(52, 211, 153, 0.95);
  fill: rgba(52, 211, 153, 0.12);
}
.region-box.kind-whiten {
  stroke: rgba(250, 204, 21, 0.95);
  fill: rgba(250, 204, 21, 0.12);
}
.region-box.kind-slim {
  stroke: rgba(167, 139, 250, 0.95);
  fill: rgba(167, 139, 250, 0.12);
}
.region-box.kind-background {
  stroke: rgba(96, 165, 250, 0.95);
  fill: rgba(96, 165, 250, 0.12);
}
.region-box.kind-erase {
  stroke: rgba(244, 114, 182, 0.95);
  fill: rgba(244, 114, 182, 0.12);
}
.region-box.draft {
  stroke-dasharray: 0.01 0.01;
}

/* ── 分割对比：左半原图压在底图上，中缝可拖 ─────────────────── */
.split-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  /* 只当画：手势统一由底图与中缝手柄负责 */
  pointer-events: none;
}

.split-tag {
  position: absolute;
  top: 8px;
  padding: 2px 6px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 10px;
  pointer-events: none;
}

.split-tag.left {
  left: 8px;
  /* 反向缩放围绕各自锚定的角，标签不会因缩放而漂进画面 */
  transform-origin: left top;
}

.split-tag.right {
  right: 8px;
  transform-origin: right top;
}

.split-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 2;
  width: 2px;
  background: var(--accent);
  cursor: col-resize;
  touch-action: none;
  outline: none;
  /* 线宽在 zoom 下由行内 transform 的 scaleX 抵消 */
  transform-origin: left center;
}

/* 细线好看但不好抓：给一条 18px 的透明命中区 */
.split-handle::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 18px;
  transform: translateX(-50%);
}

.split-handle.active,
.split-handle:focus-visible {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 65%, transparent);
}

.split-grip {
  position: absolute;
  top: 50%;
  left: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  /* translate / scale 都在行内（scale 按 1/zoom 抵消），这里只兜底居中 */
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-size: 11px;
  line-height: 1;
}

/* 分割模式下整张图都是拖动面（区域组里只认手柄，空格平移时不抢光标） */
.stage.split-mode:not(.space-pan) .stage-img {
  cursor: col-resize;
}

.draw-hint {
  position: absolute;
  left: 8px;
  bottom: 8px;
  padding: 2px 6px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 10px;
}

/* 出图状态胶囊：压在画面上沿，不被参数面板的滚动带走 */
.stage-busy {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.62);
  color: #fff;
  font-size: 11px;
  pointer-events: none;
}

.spin {
  width: 9px;
  height: 9px;
  /* 走 currentColor：叠在图片上的胶囊本身是深底白字，跟随它就不会引入硬编码白叠色 */
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  opacity: 0.85;
  animation: portrait-spin 0.8s linear infinite;
}

@keyframes portrait-spin {
  to {
    transform: rotate(360deg);
  }
}

.stage-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 8px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  min-width: 0;
}

.badge {
  padding: 1px 6px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--accent);
  white-space: nowrap;
}

.bar-btn {
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.bar-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* 对比原图：按住期间高亮，提示当前画面是原图 */
.compare-btn {
  white-space: nowrap;
}

.compare-btn.active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--accent);
}

.view-group {
  display: inline-flex;
  gap: 2px;
}

.bar-sep {
  width: 1px;
  height: 12px;
  background: var(--border);
}

.bar-info {
  color: var(--text-muted);
  white-space: nowrap;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-left: 1px solid var(--border);
  /* 极窄容器下也不要被压成一条：面板本身兜一个下限 */
  min-width: 300px;
}

/* 面板头部：组名 + 重置（重置只在最上面，属性区留给参数、底边留给出图） */
.panel-head {
  display: flex;
  align-items: center;
  gap: 6px;
  /* 窄面板放不下「组名 + 两颗重置」时折行，不要把按钮压成竖排文字 */
  flex-wrap: wrap;
  padding: 8px;
  border-bottom: 1px solid var(--border);
}

.panel-head-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}

.panel-title {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  font-weight: 600;
}

.panel-body {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 属性区域下方：重置在左、保存并出图在右，动作行始终贴住面板底边 */
.panel-foot {
  flex: 0 0 auto;
  min-width: 0;
  border-top: 1px solid var(--border);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 提示词预览：与参数规格块同一套间距（.spec-block / .form-block 共用），
   与上方参数之间用一条分隔线拉开，不再和参数挤成一坨 */
.form-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* 提示词预览：占满属性列宽度，与上面的参数块保持同样的上下留白。
   同样不参与压缩，否则整个块会被参数区挤扁，里面的手柄也就拖不出高度。 */
.prompt-block {
  flex: 0 0 auto;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

.prompt-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.prompt-tools {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* 提示词预览：右下角带拖动手柄，可以往下拖大看完整提示词。
   `flex: 0 0 auto` 不是保险：参数区是 flex 列，默认会按剩余空间压缩子项 ——
   拖出来的高度会被布局立刻压回去，表现就是「手柄拖不动」。
   缩放柄本体走全局 `textarea::-webkit-resizer`（主题化斜纹），这里只负责让位高度。 */
.text-area.prompt {
  flex: 0 0 auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  resize: vertical;
}

/* 收起后只留标题栏，属性区不再为提示词留高度 */
.prompt-block.collapsed .text-area.prompt {
  display: none;
}

.panel-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  /* 窄面板下宁可折行，也不要被压成竖排文字 */
  flex-wrap: wrap;
}

.panel-actions .run-btn {
  /* 动作行只剩主按钮：让它吃满整行，比孤零零贴右更好点 */
  flex: 1 1 140px;
  white-space: nowrap;
}

.run-btn {
  padding: 5px 12px;
  border: 1px solid var(--accent);
  border-radius: 4px;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--accent);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.run-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 跑图期间按钮原地变进度态：窗口不关，用户看得见这次点击生效了 */
.run-btn.busy {
  border-color: var(--border);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--text-muted);
}

.spec-block,
.form-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.spec-head {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.spec-label {
  font-size: 12px;
}

.spec-hint {
  font-size: 10px;
  color: var(--text-muted);
  line-height: 1.5;
}

.segmented {
  display: flex;
  gap: 2px;
  flex-wrap: wrap;
}

.seg-btn {
  flex: 1 1 auto;
  min-width: 44px;
  padding: 3px 4px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.seg-btn.active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
}

.seg-btn.risk.active {
  border-color: #f59e0b;
  background: color-mix(in srgb, #f59e0b 16%, transparent);
  color: #f59e0b;
}

.row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.row.column {
  flex-direction: column;
  align-items: stretch;
}

.row-label {
  color: var(--text-muted);
}

select,
.num-input,
.region-note {
  padding: 3px 4px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-input, transparent);
  color: var(--text);
  font-size: 11px;
}

.text-area {
  width: 100%;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  /* 右下角缩放柄的底色与文本框同源：不同源会在角上露出一块异色（见 styles/main.css） */
  --textarea-bg: var(--bg-input, transparent);
  background: var(--bg-input, transparent);
  color: var(--text);
  font-size: 11px;
  line-height: 1.6;
  resize: vertical;
  font-family: inherit;
}

.inline-check {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
}

/* 局部回贴开关：这一条决定「改哪儿」，比普通勾选项更值得看见 */
.scope-check {
  color: var(--text);
  font-weight: 600;
}

.hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 10px;
  line-height: 1.6;
}

.hint.warn {
  color: #f59e0b;
}

.hint.error {
  color: #ef4444;
}

.hint.accent {
  color: var(--accent);
}

.ghost-btn {
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.ghost-btn.tiny {
  padding: 2px 5px;
  font-size: 10px;
}

.ghost-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.preset-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}

.preset-btn {
  padding: 5px 2px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.preset-btn.active {
  border-color: var(--accent);
  color: var(--accent);
}

.preset-io {
  display: flex;
  gap: 6px;
}

.region-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.region-row {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
}

.region-index {
  width: 14px;
  color: var(--text-muted);
}

.region-kind {
  white-space: nowrap;
}

.region-note {
  flex: 1;
  min-width: 0;
}

.ai-actions {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
}

.ai-history {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.version-btn {
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: transparent;
  color: var(--text-muted);
  font-size: 10px;
  cursor: pointer;
}

.version-btn.active {
  border-color: var(--accent);
  color: var(--accent);
}

.hidden-input {
  display: none;
}
</style>
