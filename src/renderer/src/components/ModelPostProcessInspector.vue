<template>
  <div v-if="node" class="node-inspector">
    <div class="head">
      <span class="type">{{ typeLabel }}</span>
      <h2>{{ displayTitle }}</h2>
    </div>
    <p class="hint">{{ hint }}</p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <p v-if="needsUpstreamTaskId && !hasUpstreamTaskId" class="section-hint warn">
      {{ needTaskHint }}
    </p>

    <template v-if="showsModelResult">
      <div v-if="modelPreviewPath" class="preview-slot">
        <ModelPreview :relative-path="modelPreviewPath" :show-save-to-library="true" />
      </div>
      <p v-else class="section-hint">{{ previewEmptyText }}</p>
    </template>

    <section v-if="node.typeId === 'model.meshComplete'" class="field-panel">
      <label class="field">
        <span class="field-label">{{ t('graph.inspector.modelMeshComplete.mode') }}</span>
        <select
          class="field-select"
          :value="node.params.meshCompleteMode ?? 'ai_completion'"
          @change="onCompletionMode"
        >
          <option value="ai_completion">
            {{ t('graph.inspector.modelMeshComplete.modes.ai') }}
          </option>
          <option value="quick_cap">
            {{ t('graph.inspector.modelMeshComplete.modes.quickCap') }}
          </option>
        </select>
      </label>
      <MeshOpPartsPicker
        v-if="showPartNames"
        :parts="upstreamParts"
        :selected="node.params.meshCompletePartNames ?? []"
        @toggle="onTogglePart('meshCompletePartNames', $event)"
      />
      <div class="field">
        <span class="field-label">{{ t('graph.inspector.modelMeshComplete.parts') }}</span>
        <ul v-if="node.params.meshCompletePartNames?.length" class="chip-list">
          <li v-for="part in node.params.meshCompletePartNames" :key="part" class="chip">
            {{ part }}
          </li>
        </ul>
        <span v-else class="section-hint">
          {{ t('graph.inspector.modelMeshComplete.partsHint') }}
        </span>
      </div>
    </section>

    <section v-else-if="node.typeId === 'model.retopology'" class="field-panel">
      <p v-if="providerNotes.retopology" class="section-hint">{{ providerNotes.retopology }}</p>
      <label v-if="showRetopologyTier" class="field">
        <span class="field-label">{{ t('graph.inspector.modelRetopology.mode') }}</span>
        <select
          class="field-select"
          :value="node.params.retopologyMode ?? 'smart'"
          @change="onRetopologyMode"
        >
          <option value="smart">{{ t('graph.inspector.modelRetopology.modes.smart') }}</option>
          <option value="basic">{{ t('graph.inspector.modelRetopology.modes.basic') }}</option>
        </select>
      </label>
      <label class="field">
        <span class="field-label">{{ t('graph.inspector.modelRetopology.faceLimit') }}</span>
        <input
          class="field-input"
          type="number"
          min="1"
          step="100"
          :value="node.params.retopologyFaceLimit ?? ''"
          :placeholder="t('graph.inspector.modelRetopology.faceLimitHint')"
          @change="onFaceLimit"
        />
      </label>
      <label class="field field-check">
        <input
          type="checkbox"
          :checked="node.params.retopologyQuad === true"
          @change="onToggle('retopologyQuad', $event)"
        />
        <span>{{ t('graph.inspector.modelRetopology.quad') }}</span>
      </label>
      <label v-if="showRetopologyBake" class="field field-check">
        <input
          type="checkbox"
          :checked="node.params.retopologyBake !== false"
          @change="onToggle('retopologyBake', $event)"
        />
        <span>{{ t('graph.inspector.modelRetopology.bake') }}</span>
      </label>
      <MeshOpPartsPicker
        v-if="showPartNames"
        :parts="upstreamParts"
        :selected="node.params.retopologyPartNames ?? []"
        @toggle="onTogglePart('retopologyPartNames', $event)"
      />
      <div v-if="showPartNames" class="field">
        <span class="field-label">{{ t('graph.inspector.modelRetopology.parts') }}</span>
        <ul v-if="node.params.retopologyPartNames?.length" class="chip-list">
          <li v-for="part in node.params.retopologyPartNames" :key="part" class="chip">
            {{ part }}
          </li>
        </ul>
        <span v-else class="section-hint">
          {{ t('graph.inspector.modelRetopology.partsHint') }}
        </span>
      </div>
    </section>

    <section v-else-if="node.typeId === 'model.retarget'" class="field-panel">
      <label class="field">
        <span class="field-label">{{ t('graph.inspector.modelRetarget.outFormat') }}</span>
        <select
          class="field-select"
          :value="node.params.retargetOutFormat ?? 'glb'"
          @change="onRetargetFormat"
        >
          <option value="glb">GLB</option>
          <option value="fbx">FBX</option>
        </select>
      </label>
      <label class="field field-check">
        <input
          type="checkbox"
          :checked="node.params.retargetBakeAnimation !== false"
          @change="onToggle('retargetBakeAnimation', $event)"
        />
        <span>{{ t('graph.inspector.modelRetarget.bakeAnimation') }}</span>
      </label>
      <label class="field field-check">
        <input
          type="checkbox"
          :checked="node.params.retargetExportWithGeometry !== false"
          @change="onToggle('retargetExportWithGeometry', $event)"
        />
        <span>{{ t('graph.inspector.modelRetarget.exportWithGeometry') }}</span>
      </label>
      <label class="field field-check">
        <input
          type="checkbox"
          :checked="node.params.retargetAnimateInPlace === true"
          @change="onToggle('retargetAnimateInPlace', $event)"
        />
        <span>{{ t('graph.inspector.modelRetarget.animateInPlace') }}</span>
      </label>
      <p v-if="providerNotes.retarget" class="section-hint">{{ providerNotes.retarget }}</p>

      <!-- Meshy：动画从动作库选 action_id -->
      <template v-if="showAnimationLibrary">
        <div class="field">
          <span class="field-label">{{ t('graph.inspector.modelRetarget.libraryTitle') }}</span>
          <span class="section-hint inline-hint">
            {{
              t('graph.inspector.modelRetarget.librarySelected', { n: selectedActionIds.length })
            }}
          </span>
        </div>
        <div class="field">
          <input
            class="field-input grow"
            type="text"
            :value="animationSearch"
            :placeholder="t('graph.inspector.modelRetarget.librarySearchPlaceholder')"
            @input="onAnimationSearchInput"
          />
          <button
            type="button"
            class="field-btn"
            :disabled="animationLoading"
            @click="loadAnimationLibrary"
          >
            {{
              animationLoading
                ? t('graph.inspector.modelRetarget.libraryLoading')
                : t('graph.inspector.modelRetarget.libraryLoad')
            }}
          </button>
        </div>
        <ul v-if="animationActions.length" class="chip-list">
          <li v-for="action in animationActions" :key="action.id">
            <button
              type="button"
              class="chip chip-btn"
              :class="{ active: selectedActionIds.includes(Number(action.id)) }"
              :title="action.category || action.label"
              @click="toggleAction(Number(action.id))"
            >
              {{ action.label }}
            </button>
          </li>
        </ul>
        <p v-if="animationError" class="section-hint warn">{{ animationError }}</p>
        <p v-else-if="!animationActions.length && !animationLoading" class="section-hint">
          {{ t('graph.inspector.modelRetarget.libraryEmpty') }}
        </p>
        <p v-if="selectedActionIds.length" class="section-hint">
          {{ t('graph.inspector.modelRetarget.libraryToggleHint') }}
        </p>
      </template>

      <!-- Tripo：预设动画 id（在卡片指令框里填） -->
      <div v-else class="field">
        <span class="field-label">{{ t('graph.inspector.modelRetarget.animations') }}</span>
        <ul v-if="node.params.retargetAnimations?.length" class="chip-list">
          <li v-for="anim in node.params.retargetAnimations" :key="anim" class="chip">
            {{ anim }}
          </li>
        </ul>
        <span v-else class="section-hint">
          {{ t('graph.inspector.modelRetarget.animationsHint') }}
        </span>
      </div>
    </section>

    <section v-else-if="node.typeId === 'model.convert'" class="field-panel">
      <p v-if="providerNotes.convert" class="section-hint">{{ providerNotes.convert }}</p>
      <label class="field">
        <span class="field-label">{{ t('graph.inspector.modelConvert.format') }}</span>
        <select
          class="field-select"
          :value="node.params.convertFormat ?? 'FBX'"
          @change="onConvertFormat"
        >
          <option v-for="opt in CONVERT_FORMATS" :key="opt" :value="opt">{{ opt }}</option>
        </select>
      </label>
      <template v-if="showConvertAdvanced">
        <label class="field">
          <span class="field-label">{{ t('graph.inspector.modelConvert.fbxPreset') }}</span>
          <select
            class="field-select"
            :value="node.params.convertFbxPreset ?? 'blender'"
            :disabled="(node.params.convertFormat ?? 'FBX') !== 'FBX'"
            @change="onConvertFbxPreset"
          >
            <option v-for="opt in FBX_PRESETS" :key="opt" :value="opt">
              {{ t(`graph.inspector.modelConvert.fbxPresets.${opt}`) }}
            </option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">{{ t('graph.inspector.modelConvert.faceLimit') }}</span>
          <input
            class="field-input"
            type="number"
            min="1"
            step="100"
            :value="node.params.convertFaceLimit ?? ''"
            :placeholder="t('graph.inspector.modelConvert.faceLimitHint')"
            @change="onConvertFaceLimit"
          />
        </label>
        <label class="field">
          <span class="field-label">{{ t('graph.inspector.modelConvert.textureSize') }}</span>
          <select
            class="field-select"
            :value="node.params.convertTextureSize ?? 4096"
            @change="onConvertTextureSize"
          >
            <option v-for="size in TEXTURE_SIZES" :key="size" :value="size">{{ size }}</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">{{ t('graph.inspector.modelConvert.textureFormat') }}</span>
          <select
            class="field-select"
            :value="node.params.convertTextureFormat ?? 'JPEG'"
            @change="onConvertTextureFormat"
          >
            <option v-for="opt in TEXTURE_FORMATS" :key="opt" :value="opt">{{ opt }}</option>
          </select>
        </label>
        <label class="field field-check">
          <input
            type="checkbox"
            :checked="node.params.convertQuad === true"
            @change="onToggle('convertQuad', $event)"
          />
          <span>{{ t('graph.inspector.modelConvert.quad') }}</span>
        </label>
        <label class="field field-check">
          <input
            type="checkbox"
            :checked="node.params.convertPivotToCenterBottom === true"
            @change="onToggle('convertPivotToCenterBottom', $event)"
          />
          <span>{{ t('graph.inspector.modelConvert.pivotToCenterBottom') }}</span>
        </label>
        <label class="field field-check">
          <input
            type="checkbox"
            :checked="node.params.convertPackUv === true"
            @change="onToggle('convertPackUv', $event)"
          />
          <span>{{ t('graph.inspector.modelConvert.packUv') }}</span>
        </label>
        <label class="field field-check">
          <input
            type="checkbox"
            :checked="node.params.convertBake !== false"
            @change="onToggle('convertBake', $event)"
          />
          <span>{{ t('graph.inspector.modelConvert.bake') }}</span>
        </label>
        <label class="field field-check">
          <input
            type="checkbox"
            :checked="node.params.convertWithAnimation !== false"
            @change="onToggle('convertWithAnimation', $event)"
          />
          <span>{{ t('graph.inspector.modelConvert.withAnimation') }}</span>
        </label>
        <MeshOpPartsPicker
          v-if="showPartNames"
          :parts="upstreamParts"
          :selected="node.params.convertPartNames ?? []"
          @toggle="onTogglePart('convertPartNames', $event)"
        />
        <div v-if="showPartNames" class="field">
          <span class="field-label">{{ t('graph.inspector.modelConvert.parts') }}</span>
          <ul v-if="node.params.convertPartNames?.length" class="chip-list">
            <li v-for="part in node.params.convertPartNames" :key="part" class="chip">
              {{ part }}
            </li>
          </ul>
          <span v-else class="section-hint">{{ t('graph.inspector.modelConvert.partsHint') }}</span>
        </div>
      </template>
    </section>

    <section v-else-if="node.typeId === 'model.texture'" class="field-panel">
      <p v-if="providerNotes.texture" class="section-hint">{{ providerNotes.texture }}</p>
      <label v-if="showTextureVersion" class="field">
        <span class="field-label">{{ t('graph.inspector.modelTexture.version') }}</span>
        <select
          class="field-select"
          :value="node.params.textureVersion ?? 'v3.0-20250812'"
          @change="onTextureVersion"
        >
          <option v-for="opt in TEXTURE_VERSIONS" :key="opt" :value="opt">{{ opt }}</option>
        </select>
      </label>
      <label class="field">
        <span class="field-label">{{ t('graph.inspector.modelTexture.quality') }}</span>
        <select
          class="field-select"
          :value="node.params.textureQuality ?? 'standard'"
          @change="onTextureQuality"
        >
          <option v-for="opt in TEXTURE_QUALITIES" :key="opt" :value="opt">
            {{ t(`graph.inspector.modelTexture.qualities.${opt}`) }}
          </option>
        </select>
      </label>
      <label class="field">
        <span class="field-label">{{ t('graph.inspector.modelTexture.alignment') }}</span>
        <select
          class="field-select"
          :value="node.params.textureAlignment ?? 'original_image'"
          @change="onTextureAlignment"
        >
          <option value="original_image">
            {{ t('graph.inspector.modelTexture.alignments.original_image') }}
          </option>
          <option value="geometry">
            {{ t('graph.inspector.modelTexture.alignments.geometry') }}
          </option>
        </select>
      </label>
      <label v-if="showTextureSeed" class="field">
        <span class="field-label">{{ t('graph.inspector.modelTexture.seed') }}</span>
        <input
          class="field-input"
          type="number"
          min="0"
          step="1"
          :value="node.params.textureSeed ?? ''"
          :placeholder="t('graph.inspector.modelTexture.seedHint')"
          @change="onTextureSeed"
        />
      </label>
      <label class="field field-check">
        <input
          type="checkbox"
          :checked="node.params.texturePbr !== false"
          @change="onToggle('texturePbr', $event)"
        />
        <span>{{ t('graph.inspector.modelTexture.pbr') }}</span>
      </label>
      <label class="field">
        <span class="field-label">{{ t('graph.inspector.modelTexture.delight') }}</span>
        <select
          class="field-select"
          :value="
            node.params.textureDelight === undefined
              ? 'default'
              : String(node.params.textureDelight)
          "
          @change="onTextureDelight"
        >
          <option value="default">{{ t('graph.inspector.modelTexture.delightDefault') }}</option>
          <option value="true">{{ t('graph.inspector.modelTexture.delightRemove') }}</option>
          <option value="false">{{ t('graph.inspector.modelTexture.delightKeep') }}</option>
        </select>
      </label>
      <MeshOpPartsPicker
        v-if="showPartNames"
        :parts="upstreamParts"
        :selected="node.params.texturePartNames ?? []"
        @toggle="onTogglePart('texturePartNames', $event)"
      />
      <div v-if="showPartNames" class="field">
        <span class="field-label">{{ t('graph.inspector.modelTexture.parts') }}</span>
        <ul v-if="node.params.texturePartNames?.length" class="chip-list">
          <li v-for="part in node.params.texturePartNames" :key="part" class="chip">
            {{ part }}
          </li>
        </ul>
        <span v-else class="section-hint">{{ t('graph.inspector.modelTexture.partsHint') }}</span>
      </div>
    </section>

    <section v-else-if="node.typeId === 'model.rigCheck'" class="field-panel">
      <h4>{{ t('graph.inspector.modelRigCheck.resultTitle') }}</h4>
      <template v-if="node.params.rigCheckTaskId">
        <dl class="meta-list">
          <dt>{{ t('graph.inspector.modelRigCheck.riggable') }}</dt>
          <dd>{{ node.params.rigCheckRiggable ? '✓' : '✗' }}</dd>
          <dt>{{ t('graph.inspector.modelRigCheck.rigType') }}</dt>
          <dd>{{ node.params.rigCheckRigType || '—' }}</dd>
          <dt>{{ t('graph.inspector.modelRigCheck.taskId') }}</dt>
          <dd class="mono">{{ node.params.rigCheckTaskId }}</dd>
        </dl>
        <p v-if="node.params.rigCheckRiggable === false" class="section-hint warn">
          {{ t('graph.inspector.modelRigCheck.notRiggable') }}
        </p>
      </template>
      <p v-else class="section-hint">
        {{ t('graph.inspector.modelRigCheck.resultEmpty') }}
      </p>
    </section>

    <GeneratedModelsGallery v-if="hostId && showsModelResult" :node="node" :host-id="hostId" />
    <GraphNodeOutputPreview v-if="hostId" :node="node" :host-id="hostId" />
  </div>
  <div v-else class="node-inspector empty">
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import GeneratedModelsGallery from './GeneratedModelsGallery.vue'
import ModelPreview from './ModelPreview.vue'
import MeshOpPartsPicker from './MeshOpPartsPicker.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../features/graph/model/graphRunHosts'
import { useMeshOpsNodeProviderKind } from '../features/graph/model/useMeshOpsNodeProviderKind'
import { joinPartNames, togglePartName } from '../features/graph/model/meshOpParts'
import { meshOpCaps } from '@shared/meshOps'
import type { GraphNodeParams } from '@shared/graph'
import type { Model3dAnimationAction } from '@shared/modelProvider'

/**
 * Tripo 后处理四节点共用 Inspector：部件补全 / 重拓扑 / 绑骨检查 / 动画重定向。
 * 参数一律落回节点 params（卡片指令框写列表，本面板写枚举与开关）。
 */
const TYPE_IDS = [
  'model.meshComplete',
  'model.retopology',
  'model.rigCheck',
  'model.retarget',
  'model.convert',
  'model.texture'
] as const

/** 格式转换可选项（与 Tripo /v3/models/convert 对齐） */
const CONVERT_FORMATS = ['GLTF', 'FBX', 'USDZ', 'OBJ', 'STL', '3MF'] as const
const FBX_PRESETS = ['blender', '3dsmax', 'mixamo', 'bake_scale'] as const
const TEXTURE_SIZES = [512, 1024, 2048, 4096, 8192] as const
const TEXTURE_FORMATS = ['JPEG', 'PNG', 'WEBP', 'TIFF', 'TARGA'] as const
const TEXTURE_VERSIONS = ['v3.0-20250812', 'v3.5-20260815', 'v2.5-20250123'] as const
const TEXTURE_QUALITIES = ['fast', 'standard', 'detailed', 'extreme'] as const

const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  if (!current) return null
  return (TYPE_IDS as readonly string[]).includes(String(current.typeId)) ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

/** 当前 3D 供应商：决定哪些参数属于它（Tripo 与 Meshy 的可用参数集不同） */
const { providerKind } = useMeshOpsNodeProviderKind(node)

/**
 * 能力位 → 控件显隐。供应商未知（设置未加载 / 还没选）时一律按可用处理，
 * 免得面板先渲染一半再整片消失；解析出 Meshy 后 Tripo 专有项自动隐藏。
 */
const caps = computed(() => (providerKind.value ? meshOpCaps(providerKind.value) : undefined))
const showPartNames = computed(() => caps.value?.partNames !== false)
const showTextureVersion = computed(() => caps.value?.textureModelVersion !== false)
const showTextureSeed = computed(() => caps.value?.textureSeed !== false)
const showRetopologyTier = computed(() => caps.value?.retopologyTier !== false)
const showRetopologyBake = computed(() => caps.value?.retopologyBake !== false)
/** 转换面板：高级参数（FBX 预设 / 面数 / 贴图尺寸与格式 / pivot / UV / 烘焙 / 保留动画 / 部件）齐全才显示 */
const showConvertAdvanced = computed(() => caps.value?.convertAdvanced !== false)

/** 非 Tripo 时给一行说明，避免用户以为参数「丢了」 */
const providerNotes = computed(() => {
  const kind = providerKind.value
  if (!kind || kind === 'tripo') return { texture: '', retopology: '', retarget: '', convert: '' }
  return {
    texture: t('graph.inspector.modelTexture.providerNote'),
    retopology: t('graph.inspector.modelRetopology.providerNote'),
    retarget: t('graph.inspector.modelRetarget.providerNote'),
    convert: t('graph.inspector.modelConvert.providerNote')
  }
})

/** 动作库型重定向（Meshy）：动画从库里选 action_id，而不是填预设字符串 */
const showAnimationLibrary = computed(() => caps.value?.retargetIds === 'library')
const selectedActionIds = computed(() => node.value?.params.retargetActionIds ?? [])

/**
 * 上游拆分出的部件名（= 拆分后 GLB 的 node 名）。
 * 顺着 `in-model` 往上游走最多 4 跳，取第一个带 `segmentParts` 的节点——
 * 这样 segment → 部件补全 → 重拓扑 这类链式加工也能拿到同一份部件表。
 */
const upstreamParts = computed((): string[] => {
  const current = node.value
  const hid = hostId.value
  if (!current) return []
  const seen = new Set<string>([current.id])
  let cursorId = current.id
  for (let hop = 0; hop < 4; hop++) {
    const incoming = graphEditorHosts.listIncomingEdges(hid, cursorId, 'in-model')
    const sourceId = incoming[0]?.sourceNodeId
    if (!sourceId || seen.has(sourceId)) return []
    seen.add(sourceId)
    const source = graphEditorHosts.getNode(hid, sourceId)
    if (!source) return []
    const parts = source.params.segmentParts ?? []
    if (parts.length) return parts
    cursorId = source.id
  }
  return []
})

type MeshOpPartKey =
  'meshCompletePartNames' | 'retopologyPartNames' | 'convertPartNames' | 'texturePartNames'

/** 点选部件：同时把结果写回卡片指令框文本，避免手改指令框时把点选冲掉 */
function onTogglePart(key: MeshOpPartKey, part: string): void {
  const current = node.value
  if (!current) return
  const next = togglePartName(current.params[key] ?? [], part)
  patchParams({ [key]: next, generateInstruction: joinPartNames(next) } as Partial<GraphNodeParams>)
}
const animationActions = ref<Model3dAnimationAction[]>([])
const animationLoading = ref(false)
const animationError = ref('')
const animationSearch = ref('')
const animationLoadedFor = ref('')

async function loadAnimationLibrary(): Promise<void> {
  const current = node.value
  if (!current || animationLoading.value) return
  animationLoading.value = true
  animationError.value = ''
  try {
    const list = await window.studio.listModel3dAnimations({
      ...(current.params.generateProviderInstanceId
        ? { providerInstanceId: current.params.generateProviderInstanceId }
        : {}),
      ...(animationSearch.value.trim() ? { search: animationSearch.value.trim() } : {})
    })
    animationActions.value = list
    animationLoadedFor.value = current.params.generateProviderInstanceId ?? ''
  } catch (err) {
    animationError.value = err instanceof Error ? err.message : String(err)
  } finally {
    animationLoading.value = false
  }
}

function onAnimationSearchInput(event: Event): void {
  animationSearch.value = (event.target as HTMLInputElement).value
}

function toggleAction(actionId: number): void {
  if (!Number.isFinite(actionId)) return
  const has = selectedActionIds.value.includes(actionId)
  patchParams({
    retargetActionIds: has
      ? selectedActionIds.value.filter((id) => id !== actionId)
      : [...selectedActionIds.value, actionId]
  })
}

// 切到动作库型供应商时自动拉一次（免费接口），避免用户面对空列表
watch(showAnimationLibrary, (visible) => {
  if (visible && !animationLoadedFor.value && !animationActions.value.length) {
    void loadAnimationLibrary()
  }
})

const typeLabel = computed(() => graphTypeLabel(String(node.value?.typeId ?? 'model.retopology')))
const displayTitle = useNodeDisplayTitle(node, typeLabel)
/** 动态 key 在 vue-i18n 类型收紧下不可靠，这里按 typeId 静态取文案 */
const hint = computed(() => {
  switch (node.value?.typeId) {
    case 'model.meshComplete':
      return t('graph.inspector.modelMeshComplete.hint')
    case 'model.rigCheck':
      return t('graph.inspector.modelRigCheck.hint')
    case 'model.retarget':
      return t('graph.inspector.modelRetarget.hint')
    case 'model.convert':
      return t('graph.inspector.modelConvert.hint')
    case 'model.texture':
      return t('graph.inspector.modelTexture.hint')
    default:
      return t('graph.inspector.modelRetopology.hint')
  }
})

const previewEmptyText = computed(() => {
  switch (node.value?.typeId) {
    case 'model.meshComplete':
      return t('graph.inspector.modelMeshComplete.previewEmpty')
    case 'model.rigCheck':
      return t('graph.inspector.modelRigCheck.previewEmpty')
    case 'model.retarget':
      return t('graph.inspector.modelRetarget.previewEmpty')
    case 'model.convert':
      return t('graph.inspector.modelConvert.previewEmpty')
    case 'model.texture':
      return t('graph.inspector.modelTexture.previewEmpty')
    default:
      return t('graph.inspector.modelRetopology.previewEmpty')
  }
})

/** 绑骨检查只透传模型，没有新产物 */
const showsModelResult = computed(() => node.value?.typeId !== 'model.rigCheck')

/** 部件补全 / 动画重定向只认上游任务 id，缺前置时给出明确提示 */
const needsUpstreamTaskId = computed(
  () => node.value?.typeId === 'model.meshComplete' || node.value?.typeId === 'model.retarget'
)

const upstreamTaskId = computed((): string => {
  const current = node.value
  const hid = hostId.value
  if (!current) return ''
  const incoming = graphEditorHosts.listIncomingEdges(hid, current.id, 'in-model')
  const sourceId = incoming[0]?.sourceNodeId
  if (!sourceId) return ''
  const source = graphEditorHosts.getNode(hid, sourceId)
  if (!source) return ''
  return current.typeId === 'model.meshComplete'
    ? (source.params.segmentTaskId?.trim() ?? '')
    : (source.params.rigTaskId?.trim() ?? '')
})

const hasUpstreamTaskId = computed(() => !!upstreamTaskId.value)
const needTaskHint = computed(() =>
  node.value?.typeId === 'model.meshComplete'
    ? t('graph.inspector.modelMeshComplete.needTask')
    : t('graph.inspector.modelRetarget.needTask')
)

const modelPreviewPath = computed((): string | null => {
  const current = node.value
  const hid = hostId.value
  if (!current || !showsModelResult.value) return null
  const fromParams =
    current.params.meshCompleteModelRelativePath?.trim() ||
    current.params.retopologyModelRelativePath?.trim() ||
    current.params.retargetModelRelativePath?.trim() ||
    current.params.convertModelRelativePath?.trim() ||
    current.params.textureModelRelativePath?.trim()
  if (fromParams) return fromParams
  const runOut = graphRunHosts.get(hid)?.runStates?.[current.id]?.outputs?.out
  if (runOut && runOut.kind === 'asset' && runOut.relativePath?.trim()) {
    return runOut.relativePath.trim()
  }
  const incoming = graphEditorHosts.listIncomingEdges(hid, current.id, 'in-model')
  const sourceId = incoming[0]?.sourceNodeId
  if (!sourceId) return null
  const source = graphEditorHosts.getNode(hid, sourceId)
  if (!source) return null
  return (
    source.params.segmentModelRelativePath?.trim() ||
    source.params.rigModelRelativePath?.trim() ||
    source.params.poseModelRelativePath?.trim() ||
    source.params.generatedModels?.[0]?.relativePath?.trim() ||
    null
  )
})

function patchParams(patch: Partial<GraphNodeParams>): void {
  const current = node.value
  if (!hostId.value || !current) return
  graphEditorHosts.updateNode(hostId.value, current.id, patch)
}

function onCompletionMode(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  patchParams({ meshCompleteMode: value === 'quick_cap' ? 'quick_cap' : 'ai_completion' })
}

function onRetopologyMode(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  patchParams({ retopologyMode: value === 'basic' ? 'basic' : 'smart' })
}

function onRetargetFormat(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  patchParams({ retargetOutFormat: value === 'fbx' ? 'fbx' : 'glb' })
}

function onFaceLimit(event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value)
  patchParams({
    retopologyFaceLimit: Number.isFinite(raw) && raw > 0 ? Math.round(raw) : undefined
  })
}

function onToggle(key: keyof GraphNodeParams, event: Event): void {
  const checked = (event.target as HTMLInputElement).checked
  patchParams({ [key]: checked } as Partial<GraphNodeParams>)
}

function onConvertFormat(event: Event): void {
  patchParams({ convertFormat: (event.target as HTMLSelectElement).value as never })
}

function onConvertFbxPreset(event: Event): void {
  patchParams({ convertFbxPreset: (event.target as HTMLSelectElement).value })
}

function onConvertFaceLimit(event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value)
  patchParams({ convertFaceLimit: Number.isFinite(raw) && raw > 0 ? Math.round(raw) : undefined })
}

function onConvertTextureSize(event: Event): void {
  const raw = Number((event.target as HTMLSelectElement).value)
  patchParams({ convertTextureSize: Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 4096 })
}

function onConvertTextureFormat(event: Event): void {
  patchParams({ convertTextureFormat: (event.target as HTMLSelectElement).value })
}

function onTextureVersion(event: Event): void {
  patchParams({ textureVersion: (event.target as HTMLSelectElement).value })
}

function onTextureQuality(event: Event): void {
  patchParams({ textureQuality: (event.target as HTMLSelectElement).value })
}

function onTextureAlignment(event: Event): void {
  patchParams({ textureAlignment: (event.target as HTMLSelectElement).value })
}

function onTextureSeed(event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value)
  patchParams({
    textureSeed: Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : undefined
  })
}

/** 三态：default（不发，用上游默认）/ true 去光照 / false 保留光照 */
function onTextureDelight(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  patchParams({ textureDelight: value === 'default' ? undefined : value === 'true' })
}
</script>

<style scoped>
/* 与其他 inspector 同口径的容器：12px 内边距 + 12px 行距，否则内容贴边 */
.node-inspector {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  height: 100%;
  overflow: auto;
}

.node-inspector.empty {
  color: var(--text-muted);
  align-items: center;
  justify-content: center;
}

.head .type {
  font-size: 11px;
  color: var(--text-muted);
}

.head h2 {
  margin: 4px 0 0;
  font-size: 14px;
}

.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

.preview-slot {
  flex: 0 0 auto;
  width: 100%;
  min-height: 200px;
  height: 200px;
}

.preview-slot :deep(.model-preview) {
  height: 100%;
  min-height: 200px;
}

.field-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-panel h4 {
  margin: 0;
  font-size: 12px;
}

.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.field-check {
  justify-content: flex-start;
  gap: 6px;
  font-size: 12px;
}

.field-label {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  color: var(--text-2);
}

.field-select,
.field-input {
  flex: none;
  width: 140px;
  height: 26px;
  padding: 0 6px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  color: var(--text);
  font-size: 11px;
}

.chip-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.section-hint {
  margin: 0;
  padding: 12px;
  border: 1px dashed color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: 6px;
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
}

.chip {
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  font-size: 11px;
}

.chip-btn {
  cursor: pointer;
  color: var(--text);
}

.chip-btn.active {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.field-btn {
  flex: none;
  height: 26px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.field-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.field-input.grow {
  width: auto;
  flex: 1 1 auto;
}

.inline-hint {
  padding: 0;
  border: none;
  text-align: right;
}

.meta-list {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
  margin: 0;
  font-size: 12px;
}

.meta-list dt {
  color: var(--text-2);
}

.meta-list dd {
  margin: 0;
}

.mono {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  word-break: break-all;
}

.warn {
  color: var(--warning, #d08700);
}
</style>
