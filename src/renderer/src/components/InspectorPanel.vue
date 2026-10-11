<template>
  <div class="inspector-host" :class="{ stacked: mountedEditors.length > 1 }">
    <!--
      子组件渲染抛错时 Vue 会把那棵子树留空 —— 表现就是"检查器一片空白"，只有控制台有线索。
      这里把原因显示出来，用户能直接看到（也能直接反馈给我们）。
    -->
    <div v-if="childError" class="inspector-error">
      {{ t('graph.inspector.renderFailed') }} {{ childError }}
    </div>
    <div v-for="editor in mountedEditors" :key="editor.key" class="editor-frame">
      <component :is="editor.component" v-bind="editor.props" />
    </div>
    <div v-for="drawer in mountedDrawers" :key="drawer.key" class="editor-frame property-drawer">
      <component :is="drawer.component" v-bind="drawer.props" />
    </div>
    <div
      v-if="!switching && mountedEditors.length === 0 && mountedDrawers.length === 0"
      class="empty-inspector"
    >
      {{ emptyInspectorMessage }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onErrorCaptured, ref, watch, type Component } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { resolveInspectors, useInspectorTarget, type InspectorContext } from '../inspector'
import { listPropertyDrawers } from '../editor/extensions'

type MountedEditor = {
  key: string
  component: Component
  props: Record<string, unknown>
}

const props = withDefaults(
  defineProps<{
    /** 无选中时的空态文案；舞台侧栏可传入 selectHint */
    emptyNoneMessage?: string
  }>(),
  {
    emptyNoneMessage: undefined
  }
)

const { t } = useStudioI18n()
const target = useInspectorTarget()

const context = computed<InspectorContext>(() => {
  return {
    target: target.value
  }
})

const editors = computed(() => resolveInspectors(target.value, context.value))

const emptyInspectorMessage = computed(() => {
  if (target.value.kind === 'asset.multi') {
    const count = Number(target.value.meta?.count ?? 0)
    return t('studio.inspector.multiAssets', { count })
  }
  if (target.value.kind === 'none') {
    return props.emptyNoneMessage || t('studio.inspector.emptyGlobals')
  }
  return t('studio.inspector.unsupported')
})

const propertyDrawers = computed(() =>
  listPropertyDrawers().filter((drawer) => drawer.match(target.value.kind, target.value.subject))
)

/**
 * 选中切换时先卸空再挂载，避免同一 patch 里对带 Teleport 的动态检查器做 keyed 互换，
 * 触发 Vue 内部 vnode.component === null 的 unmount 崩溃。
 */
const mountedEditors = ref<MountedEditor[]>([])
const mountedDrawers = ref<MountedEditor[]>([])
const switching = ref(false)
/** 子组件渲染错误信息（显示在面板上，切换选中时清空） */
const childError = ref('')
let mountEpoch = 0

function buildMountedEditors(key: string): MountedEditor[] {
  return editors.value
    .filter((editor) => !!editor.definition.component)
    .map((editor) => ({
      key: `${key}:${editor.definition.id}`,
      component: editor.definition.component,
      props: editor.props ?? {}
    }))
}

function buildMountedDrawers(key: string): MountedEditor[] {
  return propertyDrawers.value
    .filter((drawer) => !!drawer.component)
    .map((drawer) => ({
      key: `${key}:drawer:${drawer.id}`,
      component: drawer.component,
      props: {
        target: target.value,
        value: target.value.subject
      }
    }))
}

watch(
  [target, editors, propertyDrawers],
  async () => {
    const key = target.value.key
    const epoch = ++mountEpoch
    // 换目标时清掉上一次的渲染错误（否则会一直挂在面板上）
    childError.value = ''
    const nextEditors = buildMountedEditors(key)
    const nextDrawers = buildMountedDrawers(key)

    const sameEditorKeys =
      mountedEditors.value.length === nextEditors.length &&
      mountedEditors.value.every((item, index) => item.key === nextEditors[index]?.key)
    const sameDrawerKeys =
      mountedDrawers.value.length === nextDrawers.length &&
      mountedDrawers.value.every((item, index) => item.key === nextDrawers[index]?.key)

    // 同一选中目标：只更新 props，避免无谓整树卸载
    if (sameEditorKeys && sameDrawerKeys) {
      switching.value = false
      mountedEditors.value = nextEditors
      mountedDrawers.value = nextDrawers
      return
    }

    switching.value = true
    mountedEditors.value = []
    mountedDrawers.value = []
    await nextTick()
    if (epoch !== mountEpoch) return
    if (target.value.key !== key) {
      switching.value = false
      return
    }
    mountedEditors.value = buildMountedEditors(key)
    mountedDrawers.value = buildMountedDrawers(key)
    switching.value = false
  },
  { immediate: true }
)

onErrorCaptured((err) => {
  console.error('[InspectorPanel] child error:', err)
  // 显示到面板上：子组件渲染抛错后那棵子树是空的，不给提示用户只会看到"一片空白"
  childError.value = err instanceof Error ? err.message : String(err)
  return false
})
</script>

<style scoped>
.inspector-host {
  height: 100%;
  min-height: 0;
  overflow: auto;
  background: var(--bg-panel);
}

/* 子组件渲染失败的原因（不能只留在控制台，否则用户只看到空白） */
.inspector-error {
  margin: 6px;
  padding: 6px 8px;
  border: 1px solid var(--danger, #c0392b);
  border-radius: 6px;
  background: color-mix(in srgb, var(--danger, #c0392b) 12%, transparent);
  color: var(--text);
  font-size: 12px;
  word-break: break-word;
}

.editor-frame {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

/* 多个注册编辑器命中时按 Unity 组件区块纵向堆叠，由宿主统一滚动。 */
.inspector-host.stacked .editor-frame {
  height: auto;
  overflow: visible;
  border-bottom: 1px solid var(--border);
}

.property-drawer {
  height: auto;
  border-top: 1px solid var(--border);
}

.inspector-host.stacked .editor-frame :deep(.inspector),
.inspector-host.stacked .editor-frame :deep(.node-inspector),
.inspector-host.stacked .editor-frame :deep(.note-inspector),
.inspector-host.stacked .editor-frame :deep(.output-inspector),
.inspector-host.stacked .editor-frame :deep(.group-inspector) {
  height: auto;
  overflow: visible;
}

.empty-inspector {
  padding: 18px 12px;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}
</style>
