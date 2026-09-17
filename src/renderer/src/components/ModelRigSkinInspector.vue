<template>
  <div v-if="node" class="node-inspector">
    <div class="head">
      <span class="type">{{ typeLabel }}</span>
      <h2>{{ displayTitle }}</h2>
    </div>
    <p class="hint">
      {{ t('graph.inspector.modelRigSkin.hint') }}
    </p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <div class="tabs" role="tablist" :aria-label="t('graph.inspector.modelRigSkin.tabsAria')">
      <button
        type="button"
        class="tab"
        role="tab"
        :class="{ active: activeTab === 'model' }"
        :aria-selected="activeTab === 'model'"
        @click="activeTab = 'model'"
      >
        {{ t('graph.inspector.modelRigSkin.tabs.preview') }}
      </button>
      <button
        type="button"
        class="tab"
        role="tab"
        :class="{ active: activeTab === 'skeleton' }"
        :aria-selected="activeTab === 'skeleton'"
        @click="activeTab = 'skeleton'"
      >
        {{ t('graph.inspector.modelRigSkin.tabs.skeleton') }}
      </button>
    </div>

    <!-- 共享 ModelPreview：tabs 下方、panel 上方始终挂载。v-show 不卸载
         <section>，所以 ModelPreview 始终位于 layout flow 中，display 不为
         none，clientWidth/clientHeight 永远 > 0；切 tab 时只切 props（show-
         skeleton / selected-bone），不重建 WebGLRenderer。 -->
    <ModelPreview
      v-if="modelPreviewPath"
      :relative-path="modelPreviewPath"
      :show-skeleton="activeTab === 'skeleton'"
      :selected-bone="activeTab === 'skeleton' ? selectedBone : null"
      :preset-bones="presetBones"
      @bones="onModelBones"
      @select-bone="onSelectBone"
      @skeleton-source="onSkeletonSource"
    />

    <section
      v-if="activeTab === 'model'"
      class="tab-panel"
      :aria-label="t('graph.inspector.generate.modelPreview')"
    >
      <p v-if="!modelPreviewPath" class="section-hint">
        {{ t('graph.inspector.generate.modelPreviewEmpty') }}
      </p>
    </section>

    <section
      v-if="activeTab === 'skeleton'"
      class="tab-panel"
      :aria-label="t('graph.inspector.modelRigSkin.tabs.skeleton')"
    >
      <p v-if="!modelPreviewPath" class="section-hint">
        {{ t('graph.inspector.generate.modelPreviewEmpty') }}
      </p>

      <p v-if="modelPreviewPath" class="skeleton-hint">
        {{
          skeletonSource === 'preset'
            ? t('graph.inspector.modelRigSkin.skeletonPresetHint')
            : t('graph.inspector.modelRigSkin.skeletonHint')
        }}
      </p>

      <div v-if="rigMeta" class="skeleton-info">
        <div class="skeleton-row">
          <span class="skeleton-label">{{ t('graph.inspector.modelRigSkin.armature') }}</span>
          <code class="skeleton-value">{{ rigMeta.armature }}</code>
        </div>
        <div v-if="rigMeta.presetId" class="skeleton-row">
          <span class="skeleton-label">{{ t('graph.inspector.modelRigSkin.preset') }}</span>
          <code class="skeleton-value">{{ rigMeta.presetId }}</code>
        </div>

        <div class="skeleton-row">
          <span class="skeleton-label">
            {{ t('graph.inspector.modelRigSkin.bones', { n: bonesForList.length }) }}
          </span>
        </div>
        <ul v-if="bonesForList.length" class="bone-list">
          <li
            v-for="bone in bonesForList"
            :key="bone"
            class="bone-item"
            :class="{ active: bone === selectedBone }"
            @click="onBoneListClick(bone)"
          >
            <code>{{ bone }}</code>
          </li>
        </ul>
        <p v-else class="bone-empty">
          {{ t('graph.inspector.modelRigSkin.bonesEmpty') }}
        </p>

        <div class="skeleton-row">
          <span class="skeleton-label">
            {{
              t('graph.inspector.modelRigSkin.vertexGroups', {
                n: rigMeta.vertexGroups.length
              })
            }}
          </span>
        </div>
        <ul v-if="rigMeta.vertexGroups.length" class="bone-list compact">
          <li v-for="group in rigMeta.vertexGroups" :key="group" class="bone-item">
            <code>{{ group }}</code>
          </li>
        </ul>
      </div>
      <p v-else class="section-hint">
        {{ t('graph.inspector.modelRigSkin.skeletonEmpty') }}
      </p>
    </section>

    <GraphNodeOutputPreview v-if="node && hostId" :node="node" :host-id="hostId" />
  </div>
  <div v-else class="node-inspector empty">
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import ModelPreview from './ModelPreview.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { BLENDER_RIG_TOPOLOGY_TABLE, type BlenderBoneSpec } from '@shared/blenderRigSkinGeneration'

/**
 * 3D 骨骼蒙皮节点的 inspector 拆成「模型 / 骨骼」两个 Tab：
 *
 * - 模型 Tab：`showSkeleton=false` —— 显示完整模型本体，看 mesh / 材质 / 比例。
 *
 * - 骨骼 Tab：`showSkeleton=true` —— mesh 隐藏、橙色骨架 joint + 父子连线显示
 *   （Maya/Blender 风格的双锥骨段）。`selectedBone` 同时被 3D 视图（点击 joint
 *   / 连线触发 `select-bone` 事件）和列表（点击骨头名 toggle）双向更新；空选时
 *   全部显示，选中时该 joint 变青色 + 配套 AxesHelper 显示局部坐标。骨骼列表
 *   数据源是 ModelPreview 从模型 glTF/GLB/FBX 实际扫出来的 `THREE.Bone` 名字
 *   —— 比 `rigMeta.bones` 更准确（rigMeta 是 agent 上报的字符串列表，可能与实际
 *   节点图元命名不一致或被 Blender 重命名），预览以模型为准。
 *
 * 文字摘要部分保留 armature 名称、presetId 与 vertex groups 列表（vertex groups
 * 是蒙皮权重映射——哪些顶点受哪根骨骼影响——3D 空间无法直接可视化，留作文字列表
 * 仍然有用，让用户在跑 agent 之前/之后对比蒙皮拓扑）。
 *
 * 关键实现点：**ModelPreview 是 tabs 下、所有 panel 上方的共享单例**（不是每
 * 个 tab 一个）。之前的实现把 ModelPreview 放进 `<section v-show>` 里——v-show
 * 只切 `display:none` 不卸载组件，导致第二个 ModelPreview 实例的 viewport 一
 * 直是 0×0、canvas 永远渲染不出来，看上去"骨骼预览是空白"。现在 ModelPreview
 * 始终位于 layout flow 中，切 tab 只切 props（`showSkeleton` + `selectedBone`）
 * 不重建 WebGLRenderer / canvas / scene，与 AssetInspector 三 Tab inspector
 * 的复用模式一致。
 *
 * 文本模型、骨骼蒙皮指令、常用蒙皮预设都已迁到卡片下方的「生成指令」面板
 * （双击卡片展开，参见 GraphNodeCard.vue 的 `instructionKind`），不在本 inspector
 * 内重复展示。
 *
 * 默认 Tab = 'model'，与上一轮加「输入端模型预览」之前打开 inspector 第一眼
 * 看到的内容一致，避免老用户突变感。
 */
const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

type RigSkinTab = 'model' | 'skeleton'
const activeTab = ref<RigSkinTab>('model')

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'model.rigSkin' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const typeLabel = computed(() => graphTypeLabel('model.rigSkin'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

/** 输入端 3D 模型预览源——rigMeta 写入时同步缓存的模型工程相对路径 */
const modelPreviewPath = computed((): string | null => {
  const current = node.value
  if (!current) return null
  return current.params.rigModelRelativePath?.trim() || null
})

/** 最近一次 Cook 写入的 rigMeta（文字摘要数据源：armature / presetId / vertex groups） */
const rigMeta = computed(() => node.value?.params.rigMeta ?? null)

/**
 * 骨骼列表数据源——优先用 ModelPreview 从实际模型扫出来的 `THREE.Bone` 名字
 * （与 3D 视图联动），fallback 到 rigMeta.bones（用于模型尚未加载完的过渡期）。
 */
const modelBones = ref<string[]>([])
const bonesForList = computed(() => {
  const fromModel = modelBones.value
  if (fromModel.length) return fromModel
  return rigMeta.value?.bones ?? []
})

const selectedBone = ref<string | null>(null)

/**
 * 预设骨架拓扑——rigSkin 预设路径只写 rigMeta 元数据、不把骨骼烘焙进模型文件，
 * 模型里没有 THREE.Bone 时 ModelPreview 用这份拓扑合成骨架预览。
 */
const presetBones = computed((): readonly BlenderBoneSpec[] | null => {
  const presetId = rigMeta.value?.presetId
  if (!presetId) return null
  return BLENDER_RIG_TOPOLOGY_TABLE[presetId]?.bones ?? null
})

/** 骨架来源：模型自带 baked / 预设拓扑合成 preset / 都没有 none */
const skeletonSource = ref<'baked' | 'preset' | 'none'>('none')

function onSkeletonSource(source: 'baked' | 'preset' | 'none'): void {
  skeletonSource.value = source
}

function onModelBones(names: string[]): void {
  modelBones.value = names
  if (selectedBone.value && !names.includes(selectedBone.value)) {
    selectedBone.value = null
  }
}

function onSelectBone(name: string | null): void {
  selectedBone.value = name
}

function onBoneListClick(bone: string): void {
  selectedBone.value = selectedBone.value === bone ? null : bone
}
</script>

<style scoped>
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

.tabs {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  padding: 2px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-elevated) 80%, var(--border));
}

.tab {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  border: 0;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  transition:
    background 0.12s ease,
    color 0.12s ease;
}

.tab:hover {
  color: var(--text);
}

.tab.active {
  background: var(--bg);
  color: var(--text);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--shadow) 20%, transparent);
}

.tab-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
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

.skeleton-hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

.skeleton-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--bg-elevated) 60%, transparent);
}

.skeleton-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.skeleton-label {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 500;
}

.skeleton-value {
  font-size: 11px;
  color: var(--text);
  font-family: var(--font-mono, ui-monospace, Menlo, monospace);
}

.bone-list {
  list-style: none;
  margin: 0;
  padding: 4px 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 160px;
  overflow: auto;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: 4px;
}

.bone-list.compact {
  max-height: 100px;
}

.bone-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px;
  font-size: 11px;
  color: var(--text);
  border-radius: 3px;
  cursor: pointer;
  transition:
    background 0.12s ease,
    color 0.12s ease;
}

.bone-item:hover {
  background: color-mix(in srgb, var(--bg-elevated) 80%, transparent);
}

.bone-item.active {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--accent);
}

.bone-item code {
  font-family: var(--font-mono, ui-monospace, Menlo, monospace);
}

.bone-empty {
  margin: 0;
  padding: 6px 8px;
  font-size: 11px;
  color: var(--text-muted);
  border: 1px dashed color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: 4px;
  text-align: center;
}
</style>
