<template>
  <div class="marketplace">
    <!--
      标题区与任务列表 / 执行日志等弹窗同一套写法：小字 eyebrow + 可读标题，
      标识单独一行用小字。本窗口是无窗壳的独立窗口，所以标题栏本身就是拖动条
      （见样式里的 app-region）—— 不这样做窗口就没法拖动。
    -->
    <header class="mp-titlebar">
      <div class="mp-title">
        <span class="eyebrow">{{ t('marketplace.eyebrow') }}</span>
        <h2>{{ t('marketplace.title') }}</h2>
      </div>
      <div class="mp-title-actions">
        <button type="button" class="mp-link" @click="openExternal(DEV_DOCS_URL)">
          ↗ {{ t('marketplace.devDocs') }}
        </button>
      </div>
    </header>

    <div class="mp-body">
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

      <!-- 添加第三方 MCP：只在 MCP 页签出现；点按钮弹参数对话框，不占列表空间 -->
      <div v-if="category === 'mcp'" class="mp-add-row">
        <button type="button" class="mp-btn primary" @click="addOpen = true">
          {{ t('marketplace.ext.add') }}
        </button>
        <span class="mp-hint">{{ t('marketplace.ext.addHint') }}</span>
      </div>

      <div class="mp-search">
        <input
          v-model="query"
          type="search"
          autocomplete="off"
          :aria-label="t('marketplace.searchAria')"
          :placeholder="searchPlaceholder"
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
              <strong class="mp-card-title">{{ cardHeading(card) }}</strong>
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

          <!-- 详情：MCP 是配置面板；技能 / 扩展只读展示，动作在统一区里 -->
          <div v-if="openKey === card.key" class="mp-detail">
            <McpServerCard v-if="card.key === 'mcp:server'" :info="mcp" @updated="onMcpUpdated" />
            <McpBlenderCard
              v-else-if="card.key === 'mcp:blender'"
              :info="mcp?.blenderBridge ?? null"
              :blender-mcp="blenderMcp"
              @update="onBlenderPatch"
              @updated="onBlenderUpdated"
            />
            <!-- 第三方服务卡：用户自己加的，要能改能测能删 -->
            <ExternalMcpConfig
              v-else-if="card.serverId && serverOf(card.serverId)"
              :server="serverOf(card.serverId)!"
              @patch="patchServer(card.serverId!, $event)"
              @remove="removeServer(card.serverId!)"
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

      <!--
        目录级操作与模板库都是**技能专属**，只在该页签下出现。
        放在页签判断之外会让它们在每个分类下都冒出来 —— 与当前页签无关的内容
        比没有更糟（用户会以为它属于 MCP 或扩展）。
        这两个段落也**不放在搜索的 empty 分支里**：搜不到技能时它们通常仍然可用。
      -->
      <section v-if="category === 'skills'" class="mp-section">
        <h3 class="mp-section-title">{{ t('marketplace.skillsTools') }}</h3>
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

        <h3 class="mp-section-title">{{ t('settings.skills.templateLibrary') }}</h3>
        <div class="mp-dir-row">
          <button
            type="button"
            class="mp-btn"
            :aria-expanded="templatesOpen"
            @click="templatesOpen = !templatesOpen"
          >
            {{ templatesOpen ? '▾' : '▸' }} {{ t('marketplace.toggleTemplates') }}
            <span class="mp-tab-count">{{ templates.length }}</span>
          </button>
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

    <!-- 参数面板做成对话框：5–6 项参数塞在网格上方会把列表推下去，也容易被当成筛选区 -->
    <ExternalMcpAddDialog
      v-if="addOpen"
      :open="addOpen"
      :existing-ids="externalMcp.map((server) => server.id)"
      @close="addOpen = false"
      @added="onExternalAdded"
    />
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
import type { ExternalMcpServer } from '@shared/externalMcp'
import { useStudioI18n } from '../composables/useStudioI18n'
import McpServerCard from '../components/marketplace/McpServerCard.vue'
import McpBlenderCard from '../components/marketplace/McpBlenderCard.vue'
import ExternalMcpConfig from '../components/marketplace/ExternalMcpConfig.vue'
import ExternalMcpAddDialog from '../components/marketplace/ExternalMcpAddDialog.vue'
import {
  buildMarketplaceCards,
  countByCategory,
  filterMarketplaceCards,
  marketplaceCardHeading,
  searchPlaceholderKey,
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

/** 开发者文档（本站指南页）。这里没有「网页市场」：本仓库没有远端注册表，不做假入口 */
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
/**
 * 第三方 MCP 服务列表（本窗口也负责这一段）。
 *
 * 与 blenderMcp 同一口径：落盘前先 `getSettings()` 再只替换自己这一段，
 * 否则会把另一个窗口刚改的模型 / 主题等字段整表覆盖。
 */
const externalMcp = ref<ExternalMcpServer[]>([])
let saveTimer: ReturnType<typeof setTimeout> | null = null

/** 「添加 MCP 服务」对话框的开关（表单状态在对话框内部，关掉即重置） */
const addOpen = ref(false)

const allCards = computed<MarketplaceCard[]>(() =>
  buildMarketplaceCards({
    mcp: mcp.value,
    skills: skills.value,
    plugins: plugins.value,
    external: externalMcp.value
  })
)
const counts = computed(() => countByCategory(allCards.value))
const cards = computed(() =>
  filterMarketplaceCards(allCards.value, { category: category.value, query: query.value })
)
/** 搜索框占位跟着页签走：在技能页签下说「搜索插件」是误导 */
const searchPlaceholder = computed(() => t(searchPlaceholderKey(category.value)))

function serverOf(id: string): ExternalMcpServer | undefined {
  return externalMcp.value.find((server) => server.id === id)
}

/**
 * 落盘第三方 MCP 列表。
 *
 * 先读最新设置再合并：`setSettings` 是整对象替换，直接提交本地副本会覆盖另一窗口的改动。
 */
async function persistExternal(): Promise<void> {
  try {
    const latest = await window.studio.getSettings()
    const saved = await window.studio.setSettings({
      ...latest,
      externalMcp: externalMcp.value.map((server) => ({ ...server }))
    })
    externalMcp.value = saved.externalMcp ?? []
  } catch (e) {
    isError.value = true
    message.value = e instanceof Error ? e.message : String(e)
  }
}

/**
 * 对话框预检通过 → 落盘并展开新卡片。
 *
 * 校验与预检都在对话框里完成（它才知道用户填了什么、连接结果如何）；
 * 这里只管把结果合并进设置 —— `setSettings` 是整对象替换，只有本组件持有完整设置。
 */
async function onExternalAdded(payload: {
  server: ExternalMcpServer
  toolCount: number
}): Promise<void> {
  externalMcp.value = [...externalMcp.value, payload.server]
  await persistExternal()
  addOpen.value = false
  message.value = t('marketplace.ext.added', {
    name: payload.server.name,
    count: payload.toolCount
  })
  isError.value = false
  // 直接展开刚加的卡：用户下一步多半就是核对工具清单
  openKey.value = `mcp:ext:${payload.server.id}`
}

/** 卡片里改了某个字段：就地更新并防抖落盘（打字过程中不逐字符写盘） */
function patchServer(id: string, patch: Partial<ExternalMcpServer>): void {
  externalMcp.value = externalMcp.value.map((server) =>
    server.id === id ? { ...server, ...patch, id: server.id } : server
  )
  scheduleExternalSave()
}

function scheduleExternalSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void persistExternal()
  }, SAVE_DEBOUNCE_MS)
}

async function removeServer(id: string): Promise<void> {
  const target = serverOf(id)
  if (!target) return
  // 删除是不可逆的（凭据一起没了），当场确认一次
  if (!window.confirm(t('marketplace.ext.removeConfirm', { name: target.name }))) return
  externalMcp.value = externalMcp.value.filter((server) => server.id !== id)
  if (openKey.value === `mcp:ext:${id}`) openKey.value = ''
  await persistExternal()
  message.value = t('marketplace.ext.removed', { name: target.name })
  isError.value = false
}

function selectCategory(next: MarketplaceFilter): void {
  category.value = next
  openKey.value = ''
}

function toggle(key: string): void {
  openKey.value = openKey.value === key ? '' : key
}

/** 标题 / 副标题都交给共享助手与 locale，组件里不写文案 */
function cardHeading(card: MarketplaceCard): string {
  return marketplaceCardHeading(card, t)
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

/** 导出某个内置技能模板 */
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

/** 技能卡片上的动作：按文件名反查模板后导出；没有对应模板时明确告知 */
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
    const [mcpInfo, skillsData, pluginList, templateList, settings] = await Promise.all([
      window.studio.getMcpInfo(),
      window.studio.getDshSkillsInfo(),
      window.studio.listPlugins(),
      window.studio.listSkillTemplates(),
      window.studio.getSettings()
    ])
    mcp.value = mcpInfo
    skills.value = skillsData
    plugins.value = pluginList
    templates.value = templateList
    Object.assign(blenderMcp, settings.blenderMcp)
    externalMcp.value = settings.externalMcp ?? []
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
/* 铺满窗口：无窗壳的独立窗口没有 App 顶栏，整个视图就是窗口内容 */
.marketplace {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-panel);
  color: var(--text);
}

/* 与 StudioFloatingWindow 的标题栏同一配方；本窗口无窗壳，故它兼作拖动条 */
.mp-titlebar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  min-height: 40px;
  padding: 6px 12px 6px 12px;
  /* Win 叠加标题栏控件占位：不预留时右侧按钮会被系统按钮压住 */
  padding-right: max(148px, 12px);
  user-select: none;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-elevated) 80%, transparent);
  -webkit-app-region: drag;
  app-region: drag;
}

.mp-title {
  flex: 1 1 auto;
  min-width: 0;
  pointer-events: none;
}

.eyebrow {
  display: block;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.mp-title h2 {
  margin: 2px 0 0;
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mp-title-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

/* 内容区自己滚动：标题栏固定，列表长时可滚 */
.mp-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
}

/* 页签与任务列表同一写法：下划线式，激活项蓝色下边框 */
.mp-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--border);
}

.mp-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}

.mp-tab:hover {
  color: var(--text);
}

.mp-tab.active {
  color: var(--text);
  border-bottom-color: #5a9dff;
}

.mp-tab-count {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--bg-hover);
  font-size: 10px;
  line-height: 16px;
  text-align: center;
}

.mp-search {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mp-search input {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
}

.mp-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
}

.mp-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  min-width: 0;
}

.mp-card-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.mp-card-icon {
  font-size: 16px;
  line-height: 1.3;
  color: var(--text-muted);
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
  font-weight: 600;
  overflow-wrap: anywhere;
}

.mp-card-id {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.mp-card-kind {
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 10px;
}

.mp-card-sub {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.mp-card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
  font-size: 11px;
  color: var(--text-muted);
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

.mp-card-state.on {
  color: var(--success);
}

.mp-card-state.on .mp-dot {
  background: var(--success);
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
  padding: 5px 10px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.mp-btn:hover:not(:disabled) {
  background: var(--bg-hover);
}

.mp-btn.primary {
  background: rgba(47, 107, 255, 0.22);
  border-color: rgba(47, 107, 255, 0.45);
}

/* 添加第三方 MCP：按钮行（表单在对话框里，见 ExternalMcpAddDialog） */
.mp-add-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.mp-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.mp-link {
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: #5a9dff;
  font-size: 12px;
  cursor: pointer;
}

.mp-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
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

/* 与小节标题同一写法：小字大写、加字距 */
.mp-section-title {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.mp-dir-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.mp-dir {
  flex: 1 1 260px;
  min-width: 0;
  padding: 6px 10px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  font-family: var(--mono);
  font-size: 12px;
  overflow-wrap: anywhere;
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
  margin: 0;
  font-size: 12px;
  color: var(--success);
}

.mp-msg.error {
  color: var(--danger-muted);
}
</style>
