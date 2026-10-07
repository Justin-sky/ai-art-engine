<template>
  <div class="marketplace" tabindex="-1">
    <header class="mp-head">
      <h1>{{ t('marketplace.title') }}</h1>
      <div class="mp-head-actions">
        <button type="button" class="mp-link" @click="openExternal(WEB_MARKET_URL)">
          ↗ {{ t('marketplace.webMarket') }}
        </button>
        <button type="button" class="mp-link" @click="openExternal(DEV_DOCS_URL)">
          ↗ {{ t('marketplace.devDocs') }}
        </button>
      </div>
    </header>

    <nav class="mp-tabs" role="tablist">
      <button
        v-for="tab in TABS"
        :key="tab"
        type="button"
        role="tab"
        class="mp-tab"
        :class="{ active: category === tab }"
        :aria-selected="category === tab"
        @click="selectCategory(tab)"
      >
        {{ t(`marketplace.category.${tab}`) }}
        <span class="mp-tab-count">{{ counts[tab] }}</span>
      </button>
    </nav>

    <div class="mp-search">
      <input
        v-model="query"
        type="search"
        autocomplete="off"
        :placeholder="t('marketplace.searchPlaceholder')"
      />
      <button v-if="query.trim()" type="button" class="mp-link" @click="query = ''">
        {{ t('marketplace.clearSearch') }}
      </button>
    </div>

    <p v-if="loading" class="mp-hint">{{ t('marketplace.loading') }}</p>
    <p v-else-if="loadError" class="mp-hint error">{{ loadError }}</p>

    <ul v-else-if="cards.length" class="mp-grid">
      <li v-for="card in cards" :key="card.key" class="mp-card">
        <div class="mp-card-head">
          <span class="mp-card-icon" aria-hidden="true">{{ categoryIcon(card) }}</span>
          <div class="mp-card-title-wrap">
            <strong class="mp-card-title">{{ cardTitle(card) }}</strong>
            <code class="mp-card-id">{{ card.identifier }}</code>
          </div>
          <span class="mp-card-kind">{{ t(`marketplace.category.${card.category}`) }}</span>
        </div>

        <p v-if="cardSubtitle(card)" class="mp-card-sub">{{ cardSubtitle(card) }}</p>

        <div class="mp-card-foot">
          <span v-if="card.sourceKey" class="mp-card-state" :class="{ on: card.active }">
            <span class="mp-dot" aria-hidden="true" />
            {{ t(card.sourceKey) }}
          </span>
          <span class="mp-card-meta">{{ card.meta }}</span>
        </div>

        <div class="mp-card-actions">
          <button type="button" class="mp-btn" @click="toggle(card.key)">
            {{ openKey === card.key ? t('marketplace.collapse') : t('marketplace.detail') }}
          </button>
        </div>

        <!-- 详情：MCP 是配置面板；技能 / 扩展只读展示，动作在下方统一区 -->
        <div v-if="openKey === card.key" class="mp-detail">
          <McpServerCard v-if="card.key === 'mcp:server'" :info="mcp" @updated="onMcpUpdated" />
          <McpBlenderCard
            v-else-if="card.key === 'mcp:blender'"
            :info="mcp?.blenderBridge ?? null"
            :blender-mcp="blenderMcp"
            @update="onBlenderPatch"
            @updated="onBlenderUpdated"
          />
          <template v-else>
            <p class="mp-hint">{{ t('marketplace.readOnlyHint') }}</p>
            <div class="mp-card-actions">
              <button
                v-if="card.category === 'skills'"
                type="button"
                class="mp-btn"
                :disabled="busy"
                @click="runSkillAction(card)"
              >
                {{ t('marketplace.exportSkill') }}
              </button>
            </div>
          </template>
        </div>
      </li>
    </ul>

    <p v-else class="mp-hint">
      {{ query.trim() ? t('marketplace.noMatch') : t('marketplace.empty') }}
    </p>

    <!-- 技能目录级操作：不挂在某一卡片上，避免同一动作出现多份 -->
    <section class="mp-section">
      <h2>{{ t('marketplace.skillsTools') }}</h2>
      <div class="mp-dir-row">
        <code class="mp-dir">{{ skills?.dirPath || '…' }}</code>
        <button type="button" class="mp-btn" :disabled="busy" @click="openSkillsDir">
          {{ t('settings.skills.openDir') }}
        </button>
        <button type="button" class="mp-btn" :disabled="busy" @click="writeSkillTemplate">
          {{ t('settings.skills.writeTemplate') }}
        </button>
        <button type="button" class="mp-btn" :disabled="busy" @click="importCustomSkills">
          {{ t('settings.skills.importToGraph') }}
        </button>
      </div>
      <p class="mp-hint">
        {{ t('settings.skills.builtinCount', { count: skills?.builtinCount ?? 0 }) }}
      </p>
    </section>

    <section class="mp-section">
      <h2>{{ t('settings.skills.templateLibrary') }}</h2>
      <div class="mp-dir-row">
        <button
          type="button"
          class="mp-btn"
          :aria-expanded="templatesOpen"
          @click="templatesOpen = !templatesOpen"
        >
          {{ templatesOpen ? '▾' : '▸' }} {{ t('marketplace.toggleTemplates') }}
        </button>
        <span class="mp-hint">{{ templates.length }}</span>
      </div>
      <ul v-if="templatesOpen && templates.length" class="mp-template-list">
        <li v-for="tpl in templates" :key="tpl.id" class="mp-template">
          <div class="mp-template-info">
            <code class="mp-card-id">{{ tpl.name }}</code>
            <span class="mp-template-title">{{ tpl.titleZh }} / {{ tpl.titleEn }}</span>
            <span class="mp-card-sub">{{ tpl.description }}</span>
          </div>
          <button type="button" class="mp-btn" :disabled="busy" @click="exportTemplate(tpl.id)">
            {{ t('settings.skills.exportTemplate') }}
          </button>
        </li>
      </ul>
      <p v-else-if="templatesOpen" class="mp-hint">{{ t('settings.skills.templateEmpty') }}</p>
    </section>

    <p v-if="message" class="mp-msg" :class="{ error: isError }">{{ message }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type {
  DshSkillsInfo,
  ExternalPluginManifest,
  McpBlenderBridgeInfo,
  McpServerInfo,
  SkillTemplate
} from '@shared/ipc'
import type { AppSettings } from '@shared/domain'
import { DEFAULT_SETTINGS } from '@shared/domain'
import { useStudioI18n } from '../composables/useStudioI18n'
import McpServerCard from '../components/marketplace/McpServerCard.vue'
import McpBlenderCard from '../components/marketplace/McpBlenderCard.vue'
import {
  MCP_CARD_TITLE_KEYS,
  buildMarketplaceCards,
  countByCategory,
  filterMarketplaceCards,
  type MarketplaceCard,
  type MarketplaceFilter
} from '../features/marketplace/buildMarketplaceCards'

/**
 * 插件市场（独立窗口）。
 *
 * 承载原先散在设置页的 MCP / 技能 / 扩展三块：市场是**应用级**功能，不依赖工程，
 * 因此这里刻意不碰 project store —— 窗口在主界面未开工程时也能用。
 *
 * 设置落盘要点：`setSettings` 是**整对象替换**，所以这里只把自己负责的片段
 * （`blenderMcp`）合并进「先读回来的最新设置」再写回；直接提交本地表单会覆盖掉
 * 另一个窗口刚改的模型 / 主题等字段。MCP 的端口与 token 不走这条路 ——
 * 它们由 `restartMcpServer` 独立热重启，不经过 `setSettings`。
 */

const { t } = useStudioI18n()

const WEB_MARKET_URL = 'https://justin-sky.github.io/ai-art-engine/'
const DEV_DOCS_URL = 'https://justin-sky.github.io/ai-art-engine/manual.html'
const TABS: MarketplaceFilter[] = ['all', 'mcp', 'skills', 'plugins']
const SAVE_DEBOUNCE_MS = 500

const mcp = ref<McpServerInfo | null>(null)
const skills = ref<DshSkillsInfo | null>(null)
const plugins = ref<ExternalPluginManifest[]>([])
const templates = ref<SkillTemplate[]>([])

const category = ref<MarketplaceFilter>('all')
const query = ref('')
const openKey = ref('')
const templatesOpen = ref(false)
const loading = ref(true)
const loadError = ref('')
const busy = ref(false)
const message = ref('')
const isError = ref(false)

/** 本窗口负责的设置片段；其余字段一律保留主进程里的现值 */
const blenderMcp = reactive<AppSettings['blenderMcp']>(structuredClone(DEFAULT_SETTINGS.blenderMcp))
let saveTimer: ReturnType<typeof setTimeout> | null = null

const allCards = computed<MarketplaceCard[]>(() =>
  buildMarketplaceCards({ mcp: mcp.value, skills: skills.value, plugins: plugins.value })
)
const counts = computed(() => countByCategory(allCards.value))
const cards = computed(() =>
  filterMarketplaceCards(allCards.value, { category: category.value, query: query.value })
)

function selectCategory(next: MarketplaceFilter): void {
  category.value = next
  openKey.value = ''
}

function toggle(key: string): void {
  openKey.value = openKey.value === key ? '' : key
}

function cardTitle(card: MarketplaceCard): string {
  if (card.title) return card.title
  const key = MCP_CARD_TITLE_KEYS[card.key]
  return key ? t(key) : card.identifier
}

function cardSubtitle(card: MarketplaceCard): string {
  if (card.subtitleKey) return t(card.subtitleKey)
  return card.subtitle ?? ''
}

function categoryIcon(card: MarketplaceCard): string {
  if (card.category === 'mcp') return '⚙'
  if (card.category === 'skills') return '✦'
  return '⬡'
}

/**
 * 打开外部链接。
 *
 * 走 `window.open` 而不是新 IPC：主进程的 `setWindowOpenHandler` 对非弹窗 URL
 * 统一转 `shell.openExternal`，这正是它存在的用途 —— 再加一条 IPC 只是重复这条路径。
 */
function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener')
}

function onMcpUpdated(next: McpServerInfo): void {
  mcp.value = next
}

function onBlenderUpdated(next: McpBlenderBridgeInfo): void {
  if (mcp.value) mcp.value = { ...mcp.value, blenderBridge: next }
}

/**
 * Blender 配置改动：合并进最新设置后防抖落盘。
 *
 * 先 `getSettings()` 再只替换 `blenderMcp` —— 否则会把另一个窗口刚保存的字段全部覆盖。
 */
function onBlenderPatch(patch: Partial<AppSettings['blenderMcp']>): void {
  Object.assign(blenderMcp, patch)
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void persistBlender()
  }, SAVE_DEBOUNCE_MS)
}

async function persistBlender(): Promise<void> {
  try {
    const latest = await window.studio.getSettings()
    const saved = await window.studio.setSettings({ ...latest, blenderMcp: { ...blenderMcp } })
    Object.assign(blenderMcp, saved.blenderMcp)
  } catch (e) {
    isError.value = true
    message.value = e instanceof Error ? e.message : String(e)
  }
}

async function openSkillsDir(): Promise<void> {
  busy.value = true
  isError.value = false
  message.value = ''
  try {
    await window.studio.openDshSkillsDir()
  } catch (e) {
    isError.value = true
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
    await refreshSkills()
  }
}

async function writeSkillTemplate(): Promise<void> {
  busy.value = true
  isError.value = false
  try {
    const result = await window.studio.writeDshSkillsTemplate()
    message.value = result.skipped
      ? t('settings.skills.templateSkipped', { file: result.filePath })
      : t('settings.skills.templateWritten', { file: result.filePath })
  } catch (e) {
    isError.value = true
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
    await refreshSkills()
  }
}

async function importCustomSkills(): Promise<void> {
  busy.value = true
  isError.value = false
  message.value = ''
  try {
    const result = await window.studio.importCustomSkillsToGraph()
    if (result.imported.length > 0) {
      message.value = t('settings.skills.imported', {
        count: result.imported.length,
        names: result.imported.join(', ')
      })
    } else if (result.skipped.length > 0) {
      isError.value = true
      message.value = t('settings.skills.importSkipped', {
        names: result.skipped.map((item) => item.name).join(', ')
      })
    } else {
      message.value = t('settings.skills.importEmpty')
    }
  } catch (e) {
    isError.value = true
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
    await refreshSkills()
  }
}

/** 导出该技能模板（按技能文件名反查模板 id） */
async function exportTemplate(id: string): Promise<void> {
  busy.value = true
  isError.value = false
  message.value = ''
  try {
    const result = await window.studio.exportSkillTemplate(id)
    message.value = result.skipped
      ? t('settings.skills.templateExportedSkipped', { file: result.filePath })
      : t('settings.skills.templateExported', { file: result.filePath })
  } catch (e) {
    isError.value = true
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
    await refreshSkills()
  }
}

/** 技能卡片上的动作：按文件名匹配模板后导出；没有对应模板时提示用户 */
function runSkillAction(card: MarketplaceCard): void {
  const stem = card.identifier.replace(/\.md$/i, '')
  const tpl = templates.value.find((item) => item.name === stem)
  if (!tpl) {
    isError.value = true
    message.value = t('marketplace.skillNoTemplate')
    return
  }
  void exportTemplate(tpl.id)
}

async function refreshSkills(): Promise<void> {
  try {
    skills.value = await window.studio.getDshSkillsInfo()
  } catch (e) {
    isError.value = true
    message.value = e instanceof Error ? e.message : String(e)
  }
}

onMounted(async () => {
  try {
    const [mcpInfo, skillsInfo, pluginList, templateList, settings] = await Promise.all([
      window.studio.getMcpInfo(),
      window.studio.getDshSkillsInfo(),
      window.studio.listPlugins(),
      window.studio.listSkillTemplates(),
      window.studio.getSettings()
    ])
    mcp.value = mcpInfo
    skills.value = skillsInfo
    plugins.value = pluginList
    templates.value = templateList
    Object.assign(blenderMcp, settings.blenderMcp)
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.marketplace {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  overflow: auto;
  padding: 18px 20px 28px;
  background: var(--bg-app);
  color: var(--text);
}

.mp-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.mp-head h1 {
  font-size: 18px;
  margin: 0;
}

.mp-head-actions {
  display: flex;
  gap: 8px;
}

.mp-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 8px;
  flex-wrap: wrap;
}

.mp-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 13px;
}

.mp-tab.active {
  color: var(--text);
  background: var(--bg-elevated);
  border-color: var(--border);
}

.mp-tab-count {
  font-size: 11px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-muted);
}

.mp-search {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mp-search input {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
}

.mp-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.mp-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  min-width: 0;
}

.mp-card-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.mp-card-icon {
  font-size: 18px;
  line-height: 1.2;
}

.mp-card-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.mp-card-title {
  font-size: 13px;
  overflow-wrap: anywhere;
}

.mp-card-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.mp-card-kind {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(47, 107, 255, 0.45);
  color: var(--accent);
  flex-shrink: 0;
}

.mp-card-sub {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0;
  overflow-wrap: anywhere;
}

.mp-card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--text-muted);
  margin-top: auto;
}

.mp-card-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.mp-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-muted);
}

.mp-card-state.on .mp-dot {
  background: var(--success);
}

.mp-card-state.on {
  color: var(--success);
}

.mp-card-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.mp-detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

.mp-btn {
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font-size: 12px;
}

.mp-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.mp-link {
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  font-size: 12px;
}

.mp-hint {
  color: var(--text-muted);
  font-size: 12px;
  margin: 0;
  line-height: 1.5;
}

.mp-hint.error {
  color: var(--danger-muted);
}

.mp-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.mp-section h2 {
  font-size: 13px;
  margin: 0;
  color: var(--text-muted);
}

.mp-dir-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.mp-dir {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  overflow-wrap: anywhere;
  flex: 1 1 260px;
  min-width: 0;
}

.mp-template-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.mp-template {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px solid var(--border);
}

.mp-template-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.mp-template-title {
  font-size: 12px;
}

.mp-msg {
  color: var(--success);
  font-size: 12px;
  margin: 0;
}

.mp-msg.error {
  color: var(--danger-muted);
}
</style>
