<template>
  <div
    v-if="node"
    class="instruction-panel"
    data-testid="decisions-questions-panel"
    @pointerdown.stop
    @dblclick.stop
    @wheel.stop
  >
    <div class="instruction-panel-label">
      {{ t('graph.inspector.generate.instruction') }}
    </div>
    <DecisionQuestionsEditor
      :model-value="questions"
      :host-id="hostId"
      :node-id="node.id"
      :model-id="currentModelId"
      @update:model-value="questions = $event"
      @change="persistQuestions"
    />
    <div class="decisions-footer">
      <InstructionModelSelect
        v-model="selectedModelKey"
        :options="modelOptions"
        :title="t('graph.inspector.decisions.model')"
        :empty-label="t('graph.inspector.decisions.noModel')"
        @change="persistModel"
      />
    </div>
    <!-- 只在真的没有可选模型时提示；列表一有模型就完全不出这行 -->
    <p v-if="!modelOptions.length && emptyHint" class="decisions-hint decisions-empty">
      {{ emptyHint }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { GraphNode } from '@shared/graph'
import DecisionQuestionsEditor from './DecisionQuestionsEditor.vue'
import InstructionModelSelect from './InstructionModelSelect.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import {
  invalidateGenerateModelSettingsCache,
  loadGenerateModelOptions,
  parseModelKey,
  preferredModelKey,
  type EmptyModelOptionsReason,
  type GenerateModelOption
} from '../features/graph/model/generateModelOptions'

/**
 * 决策判定节点的卡内「判定问题」面板（双击节点展开 / 收起）。
 *
 * 只编辑 `decisionQuestions`（每行一条 `名称 | 类型 | 问题 | 判定说明`）与决策模型；
 * 阈值等其余参数在右侧 Inspector 里。文本框自带放大按钮，可切到全屏记事本编辑。
 *
 * 外层刻意复用 GraphNodeCard 的 `instruction-panel` / `instruction-panel-label` 两个类：
 * 那张浮层（绝对定位到卡片下方 + 绿框 + 投影）由卡片的 scoped 样式定义，父级作用域
 * 会作用到子组件根元素上，这样本面板与其它节点的生成指令面板长得完全一致，
 * 不必复制一遍定位与配色。其余只需要面板内部的排版。
 */
const props = defineProps<{
  node: GraphNode
  hostId: string
}>()

const { t } = useStudioI18n()

const questions = ref(props.node.params.decisionQuestions ?? '')
const modelOptions = ref<GenerateModelOption[]>([])
const selectedModelKey = ref('')
const emptyReason = ref<EmptyModelOptionsReason | null>(null)

/** 列表为空时说明成因（未添加提供商 / 提供商被停用 / 缺 Key / 该模态没勾模型） */
const emptyHint = computed(() => {
  const reason = emptyReason.value
  if (!reason || reason === 'unknown') {
    return t('graph.inspector.decisions.modelHint')
  }
  return t(`graph.inspector.decisions.modelEmpty.${reason}`)
})

const initialKey = computed(() =>
  preferredModelKey(props.node.params.generateProviderInstanceId, props.node.params.generateModel)
)

/** 表单预览里展示的模型 id：优先节点已保存的选择，其次当前下拉值 */
const currentModelId = computed(
  () =>
    props.node.params.generateModel?.trim() || parseModelKey(selectedModelKey.value)?.model || ''
)

onMounted(async () => {
  questions.value = props.node.params.decisionQuestions ?? ''
  const { options, selectedKey, emptyReason: reason } = await loadModels()
  modelOptions.value = options
  selectedModelKey.value = selectedKey
  emptyReason.value = reason
})

/**
 * 每次展开都重新读设置：选项只在挂载时取一次，若在设置页勾完模型再回画布展开，
 * 不该还显示「请先在设置里拉取」——那是设置缓存过期，不是真的没配。
 * 于是每次都清掉 15s 短缓存再读，保证「有模型时就不显示提示」。
 */
async function loadModels(): Promise<{
  options: GenerateModelOption[]
  selectedKey: string
  emptyReason: EmptyModelOptionsReason | null
}> {
  invalidateGenerateModelSettingsCache()
  return loadGenerateModelOptions('decisions', initialKey.value)
}

function persistQuestions(): void {
  graphEditorHosts.updateNode(props.hostId, props.node.id, {
    decisionQuestions: questions.value
  })
}

function persistModel(): void {
  const parsed = parseModelKey(selectedModelKey.value)
  graphEditorHosts.updateNode(props.hostId, props.node.id, {
    generateProviderInstanceId: parsed?.providerInstanceId ?? '',
    generateModel: parsed?.model ?? ''
  })
}
</script>

<style scoped>
.decisions-hint {
  margin: 0;
  font-size: 10px;
  line-height: 1.4;
  color: var(--text-muted);
}

.decisions-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

/* 空列表成因提示：用告警色，与上方的格式说明区分开 */
.decisions-empty {
  color: #d9a441;
}
</style>
