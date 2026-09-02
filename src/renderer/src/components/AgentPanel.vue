<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { AgentRuntimeStatus } from '@shared/ipc'
import ChatPanel from './ChatPanel.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { promptConfirm, promptText } from '../composables/useStudioPrompt'

const { t } = useStudioI18n()

/** 全部 agent（含运行状态），来自主进程 agentRegistry */
const agents = ref<AgentRuntimeStatus[]>([])
/** 当前激活的 agent 标签 */
const activeId = ref('default')
/** 当前激活的 agent 配置（未找到时 null → 内容区显示默认 ChatPanel） */
const activeAgent = computed(
  () => agents.value.find((a) => a.agentId === activeId.value) ?? null
)

async function refresh(): Promise<void> {
  try {
    agents.value = await window.studio.listAgents()
  } catch {
    // 主进程暂不可用：保持默认 agent 可用的降级（标签栏只剩 default）
    agents.value = []
  }
}

onMounted(refresh)

/** 新建自定义 agent：两步输入（名称 → 角色描述），保存后切到新标签 */
async function onAdd(): Promise<void> {
  const name = await promptText({
    title: t('studio.agents.newTitle'),
    message: t('studio.agents.newName'),
    placeholder: t('studio.agents.newNamePlaceholder')
  })
  if (!name?.trim()) return
  const prompt = await promptText({
    title: t('studio.agents.newTitle'),
    message: t('studio.agents.newPrompt'),
    placeholder: t('studio.agents.newPromptPlaceholder'),
    defaultValue: name.trim()
  })
  if (prompt === null) return
  const id = `custom-${Date.now().toString(36)}`
  try {
    agents.value = await window.studio.saveAgentConfig({
      agentId: id,
      name: name.trim(),
      profile: 'custom',
      ...(prompt.trim() ? { systemPrompt: prompt.trim() } : {})
    })
    activeId.value = id
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // 保存失败（如 id 非法）静默忽略，标签栏不变
    void message
  }
}

/** 删除自定义 agent（内置预设不可删） */
async function onRemove(agent: AgentRuntimeStatus): Promise<void> {
  const ok = await promptConfirm({
    title: t('studio.agents.removeTitle'),
    message: t('studio.agents.removeMessage', { name: agent.name }),
    confirmLabel: t('studio.agents.removeConfirm')
  })
  if (!ok) return
  try {
    agents.value = await window.studio.removeAgent(agent.agentId)
    if (activeId.value === agent.agentId) {
      activeId.value = agents.value[0]?.agentId ?? 'default'
    }
  } catch {
    // 删除失败不阻塞
  }
}

/** 切换标签时刷新运行状态点 */
function onTabClick(id: string): void {
  activeId.value = id
  void refresh()
}
</script>

<template>
  <div class="agent-panel">
    <div class="agent-tabs">
      <button
        v-for="agent in agents"
        :key="agent.agentId"
        type="button"
        class="agent-tab"
        :class="{ active: agent.agentId === activeId }"
        :style="agent.color ? { '--agent-color': agent.color } : undefined"
        :title="agent.agentId"
        @click="onTabClick(agent.agentId)"
      >
        <span
          class="agent-dot"
          :class="{ running: agent.running }"
          :title="agent.running ? t('studio.agents.running') : ''"
        />
        <span class="agent-name">{{ agent.name }}</span>
        <span
          v-if="agent.agentId !== 'default' && !agent.builtin"
          class="agent-remove"
          :title="t('studio.agents.removeTitle')"
          @click.stop="onRemove(agent)"
        >
          ×
        </span>
      </button>
      <button
        type="button"
        class="agent-add"
        :title="t('studio.agents.addTitle')"
        @click="onAdd"
      >
        ＋
      </button>
    </div>
    <div class="agent-body">
      <KeepAlive :max="6">
        <ChatPanel
          v-if="activeAgent"
          :key="activeAgent.agentId"
          :agent-id="activeAgent.agentId"
        />
      </KeepAlive>
    </div>
  </div>
</template>

<style scoped>
.agent-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.agent-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px 4px;
  border-bottom: 1px solid var(--panel-border, rgba(128, 128, 128, 0.2));
  flex: none;
  overflow-x: auto;
}
.agent-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary, #9aa4b2);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s ease, color 0.15s ease;
}
.agent-tab:hover {
  background: var(--hover-bg, rgba(128, 128, 128, 0.12));
  color: var(--text-primary, #e6e9ef);
}
.agent-tab.active {
  background: color-mix(in srgb, var(--agent-color, #37b26c) 18%, transparent);
  border-color: color-mix(in srgb, var(--agent-color, #37b26c) 40%, transparent);
  color: var(--text-primary, #e6e9ef);
}
.agent-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-tertiary, #5b6472);
  flex: none;
}
.agent-dot.running {
  background: var(--agent-color, #37b26c);
  box-shadow: 0 0 6px var(--agent-color, #37b26c);
}
.agent-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.agent-remove {
  color: var(--text-tertiary, #5b6472);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  border-radius: 3px;
  padding: 0 2px;
}
.agent-remove:hover {
  color: #e5484d;
  background: rgba(229, 72, 77, 0.15);
}
.agent-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px dashed var(--panel-border, rgba(128, 128, 128, 0.3));
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary, #9aa4b2);
  font-size: 14px;
  cursor: pointer;
  flex: none;
  margin-left: 2px;
}
.agent-add:hover {
  color: var(--text-primary, #e6e9ef);
  border-color: var(--text-secondary, #9aa4b2);
}
.agent-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
