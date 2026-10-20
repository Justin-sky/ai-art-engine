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

      <!-- 从 GitHub 直接添加 Claude Code 技能：在技能页签展示 -->
      <div v-if="category === 'skills'" class="mp-github-box">
        <div class="mp-github-bar">
          <input
            v-model="githubUrl"
            type="url"
            autocomplete="off"
            :placeholder="t('marketplace.github.placeholder')"
            :aria-label="t('marketplace.github.placeholder')"
            @keydown.enter.prevent="inspectGitHubSkills()"
          />
          <button
            type="button"
            class="mp-btn primary"
            :disabled="githubInspecting || !githubUrl.trim()"
            @click="inspectGitHubSkills()"
          >
            {{
              githubInspecting
                ? t('marketplace.github.inspecting')
                : t('marketplace.github.inspect')
            }}
          </button>
          <button
            v-if="githubDiscovered.length > 0 || githubError"
            type="button"
            class="mp-link"
            @click="clearGitHubInspect()"
          >
            {{ t('marketplace.clearSearch') }}
          </button>
        </div>
        <span class="mp-hint">{{ t('marketplace.github.hint') }}</span>
        <p v-if="githubError" class="mp-hint error">{{ githubError }}</p>

        <div v-if="githubDiscovered.length > 0" class="mp-github-results">
          <div class="mp-github-head">
            <span class="mp-github-repo">
              <code>{{ githubOwnerRepo }}</code>
              <span v-if="githubRef" class="mp-card-kind">{{ githubRef }}</span>
              <span class="mp-hint">
                {{ t('marketplace.github.foundCount', { count: githubDiscovered.length }) }}
              </span>
            </span>
            <div class="mp-card-actions">
              <button
                type="button"
                class="mp-btn primary"
                :disabled="githubInstalling || selectedGitHubSkills.length === 0"
                @click="installSelectedGitHubSkills()"
              >
                {{
                  githubInstalling
                    ? t('marketplace.workflows.installing')
                    : t('marketplace.github.installSelected', {
                        count: selectedGitHubSkills.length
                      })
                }}
              </button>
            </div>
          </div>
          <ul class="mp-github-list">
            <li v-for="item in githubDiscovered" :key="item.name" class="mp-github-item">
              <label class="mp-github-check">
                <input
                  type="checkbox"
                  :checked="selectedGitHubSkillNames.includes(item.name)"
                  @change="toggleGitHubSkillSelection(item.name)"
                />
                <div class="mp-github-item-main">
                  <div class="mp-github-item-title">
                    <strong>{{ item.name }}</strong>
                    <code>/{{ item.name }}</code>
                    <code v-if="item.argumentHint" class="mp-badge-code">{{
                      item.argumentHint
                    }}</code>
                    <span v-if="item.context === 'fork'" class="mp-card-kind">context: fork</span>
                    <span v-if="item.model" class="mp-card-kind">{{ item.model }}</span>
                    <span v-if="item.allowedTools?.length" class="mp-card-kind">
                      allowed-tools ({{ item.allowedTools.length }})
                    </span>
                    <span v-if="item.hasScripts" class="mp-card-state warn">
                      {{ t('marketplace.workflows.skillWithScripts') }}
                    </span>
                    <span v-if="item.installed" class="mp-card-state on">
                      {{ t('marketplace.workflows.installedTag') }}
                    </span>
                  </div>
                  <p v-if="item.description" class="mp-card-sub">{{ item.description }}</p>
                </div>
              </label>
            </li>
          </ul>
        </div>
      </div>

      <!-- 技能页签：远端技能市场来源行（含手动刷新与离线提示） -->
      <div v-if="category === 'skills'" class="mp-add-row">
        <button
          type="button"
          class="mp-btn"
          :disabled="workflowRefreshing || batchInstalling"
          @click="refreshWorkflowCatalog()"
        >
          {{
            workflowRefreshing
              ? t('marketplace.workflows.refreshing')
              : t('marketplace.workflows.refresh')
          }}
        </button>
        <button
          v-if="pendingSafeWorkflowEntries.length > 0"
          type="button"
          class="mp-btn primary"
          :disabled="batchInstalling || workflowRefreshing"
          @click="installAllSafeWorkflows()"
        >
          {{
            batchInstalling
              ? t('marketplace.workflows.installingAll', {
                  done: batchProgressDone,
                  total: batchProgressTotal
                })
              : t('marketplace.workflows.installAllSafe', {
                  count: pendingSafeWorkflowEntries.length
                })
          }}
        </button>
        <span v-if="workflowError" class="mp-hint error">{{ workflowError }}</span>
        <!-- 首次加载中：不要显示「共 0 个」，那会被当成「市场是空的」 -->
        <span v-else-if="workflowLoading" class="mp-hint">
          {{ t('marketplace.workflows.loading') }}
        </span>
        <span v-else class="mp-hint">
          {{
            workflowUsedFallback
              ? t('marketplace.workflows.viaMirror', { count: workflowEntries.length })
              : t('marketplace.workflows.sourceHint', { count: workflowEntries.length })
          }}
        </span>
        <!-- 刷新失败但手上还有旧内容：软提示，不用错误顶掉列表 -->
        <span v-if="workflowRefreshFailed" class="mp-hint error">
          {{ t('marketplace.workflows.refreshFailed') }}
        </span>
      </div>

      <!-- 技能二级分类：只列数据里真实出现过的分类 -->
      <nav v-if="category === 'skills'" class="mp-tabs mp-subtabs" role="tablist">
        <button
          type="button"
          role="tab"
          class="mp-tab"
          :class="{ active: workflowCategory === '' }"
          :aria-selected="workflowCategory === ''"
          @click="workflowCategory = ''"
        >
          {{ t('marketplace.workflows.categoryAll') }}
        </button>
        <button
          v-for="key in workflowCategories"
          :key="key"
          type="button"
          role="tab"
          class="mp-tab"
          :class="{ active: workflowCategory === key }"
          :aria-selected="workflowCategory === key"
          @click="workflowCategory = key"
        >
          {{ t(skillCategoryKey(key)) }}
        </button>
      </nav>

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
            <!-- 工作流卡有封面就显示封面（封面来自远端，缺失时回落图标，不造假图） -->
            <img
              v-if="card.marketId && workflowCovers[card.marketId]"
              class="mp-card-cover"
              :src="workflowCovers[card.marketId]"
              alt=""
            />
            <span v-else class="mp-card-icon" aria-hidden="true">{{ categoryIcon(card) }}</span>
            <div class="mp-card-title-wrap">
              <strong class="mp-card-title">{{ cardHeading(card) }}</strong>
              <code class="mp-card-id">{{ card.identifier }}</code>
            </div>
            <span class="mp-card-kind">{{ t(`marketplace.category.${card.category}`) }}</span>
          </div>

          <p v-if="cardSubtitle(card)" class="mp-card-sub">{{ cardSubtitle(card) }}</p>

          <div v-if="card.capabilityKeys?.length || card.tags?.length" class="mp-card-chips">
            <span v-for="capKey in card.capabilityKeys ?? []" :key="capKey" class="mp-chip cap">
              {{ t(capKey) }}
            </span>
            <span v-for="tag in (card.tags ?? []).slice(0, 4)" :key="tag" class="mp-chip tag">
              #{{ tag }}
            </span>
          </div>

          <div class="mp-card-foot">
            <span v-if="card.sourceKey" class="mp-card-state" :class="{ on: card.active }">
              <span class="mp-dot" aria-hidden="true" />
              {{ t(card.sourceKey) }}
            </span>
            <span v-if="card.githubRepo" class="mp-card-byline" :title="card.githubRepo">
              {{ card.githubRepo }}
            </span>
            <span v-if="card.skillContext === 'fork'" class="mp-card-kind">fork</span>
            <!-- 工作流卡：作者 · 节点数（作者是署名，必须能看出来源） -->
            <span v-if="card.marketId" class="mp-card-byline">
              {{ card.author }}
              <template v-if="card.nodeCount"
                >· {{ t('marketplace.workflows.nodes', { count: card.nodeCount }) }}</template
              >
            </span>
            <!--
              随包附带技能时必须在**装之前**就看得见：装完 agent 手里会多一份操作手册，
              这是用户判断「要不要装」的信息；含脚本则更要提前说清（脚本会被执行）。
            -->
            <span
              v-if="card.skill"
              class="mp-card-state"
              :title="card.skill.description"
              :class="{ warn: skillHasScripts(card.skill) }"
            >
              {{
                skillHasScripts(card.skill)
                  ? t('marketplace.workflows.skillWithScripts')
                  : t('marketplace.workflows.skillIncluded')
              }}
            </span>
            <!--
              含可执行代码（script.run）必须在**装之前**就标出来：这条工作流会执行自带代码
              （受限沙箱里，无 fs / 网络 / require），装前要用户逐次同意。不标就等于不告知。
            -->
            <span
              v-if="cardHasExecutableCode(card)"
              class="mp-card-state warn"
              :title="t('marketplace.workflows.executableCodeHint')"
            >
              {{ t('marketplace.workflows.executableCode') }}
            </span>
            <span class="mp-card-meta">{{ card.meta }}</span>
          </div>

          <div class="mp-card-actions">
            <!--
              工作流的安装 / 使用 / 卸载**直接放在卡片上**，不必先展开详情。
              这些是卡片最常见的动作，藏进详情等于每次操作都要多点一下。
            -->
            <template v-if="card.marketId">
              <button
                type="button"
                class="mp-btn primary"
                :disabled="installingId === card.marketId || card.blockReason === 'appTooOld'"
                @click="installMarketWorkflow(card)"
              >
                {{
                  installingId === card.marketId
                    ? t('marketplace.workflows.installing')
                    : card.installed
                      ? card.updatable
                        ? t('marketplace.workflows.update')
                        : t('marketplace.workflows.reinstall')
                      : t('marketplace.workflows.install')
                }}
              </button>
              <button
                v-if="card.installed && card.skill?.name"
                type="button"
                class="mp-btn"
                @click="copySlashCommand(card.skill.name)"
              >
                {{ t('marketplace.workflows.copySlash', { name: card.skill.name }) }}
              </button>
              <button
                v-if="card.installed"
                type="button"
                class="mp-btn danger"
                @click="uninstallMarketWorkflow(card)"
              >
                {{ t('marketplace.workflows.uninstall') }}
              </button>
            </template>
            <button
              v-if="card.category === 'skills' && canUninstallSkillCard(card)"
              type="button"
              class="mp-btn danger"
              :disabled="busy"
              @click="uninstallLocalSkill(card)"
            >
              {{ t('marketplace.workflows.uninstall') }}
            </button>
            <!-- 详情是次要动作：往右推，与安装 / 卸载分开，避免误点 -->
            <button
              type="button"
              class="mp-btn"
              :class="{
                'mp-btn-push-end':
                  !!card.marketId || (card.category === 'skills' && canUninstallSkillCard(card))
              }"
              @click="toggle(card.key)"
            >
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
            <!--
              技能详情：展示 Claude Code SKILL.md 完整规范字段。
            -->
            <template v-else-if="card.category === 'skills'">
              <dl class="mp-facts">
                <div class="mp-fact">
                  <dt>{{ t('marketplace.skill.file') }}</dt>
                  <dd>
                    <code>{{ card.identifier }}</code>
                  </dd>
                </div>
                <div v-if="card.userInvocable !== false" class="mp-fact">
                  <dt>{{ t('marketplace.skill.slash') }}</dt>
                  <dd>
                    <code
                      >/{{ card.identifier.replace(/\.md$/i, '')
                      }}{{ card.argumentHint ? ` ${card.argumentHint}` : '' }}</code
                    >
                  </dd>
                </div>
                <div v-if="card.subtitle" class="mp-fact">
                  <dt>{{ t('marketplace.skill.purpose') }}</dt>
                  <dd>{{ card.subtitle }}</dd>
                </div>
                <div v-if="card.whenToUse" class="mp-fact">
                  <dt>{{ t('marketplace.skill.whenToUse') }}</dt>
                  <dd>{{ card.whenToUse }}</dd>
                </div>
                <div v-if="card.sourceKey" class="mp-fact">
                  <dt>{{ t('marketplace.skill.source') }}</dt>
                  <dd>
                    {{ t(card.sourceKey) }}
                    <code v-if="card.githubRepo">
                      ({{ card.githubRepo }}{{ card.githubRef ? `@${card.githubRef}` : '' }})
                    </code>
                  </dd>
                </div>
                <div v-if="card.skillContext" class="mp-fact">
                  <dt>{{ t('marketplace.skill.context') }}</dt>
                  <dd>
                    <code>{{ card.skillContext }}</code>
                    <span v-if="card.skillAgent"> · {{ card.skillAgent }}</span>
                  </dd>
                </div>
                <div v-if="card.skillModel" class="mp-fact">
                  <dt>{{ t('marketplace.skill.model') }}</dt>
                  <dd>
                    <code>{{ card.skillModel }}</code>
                  </dd>
                </div>
                <div v-if="card.allowedTools?.length" class="mp-fact">
                  <dt>{{ t('marketplace.skill.allowedTools') }}</dt>
                  <dd>
                    <code>{{ card.allowedTools.join(', ') }}</code>
                  </dd>
                </div>
                <div class="mp-fact">
                  <dt>{{ t('marketplace.skill.depCheck') }}</dt>
                  <dd>
                    <span class="mp-card-state" :class="skillDepReport(card).ready ? 'on' : 'warn'">
                      {{
                        skillDepReport(card).ready
                          ? t('marketplace.skill.depReady')
                          : t('marketplace.skill.depMissingMcp', {
                              services: skillDepReport(card).missingMcpServices.join(', ')
                            })
                      }}
                    </span>
                  </dd>
                </div>
              </dl>
              <p class="mp-hint">{{ t('marketplace.skill.hint') }}</p>
            </template>
            <!--
              工作流详情：作者 / 许可 / 节点数 + **依赖缺失清单**。
              缺节点类型必须在「使用」之前说清楚 —— 否则用户会落进一个残图。
            -->
            <template v-else-if="card.category === 'workflows'">
              <dl class="mp-facts">
                <div class="mp-fact">
                  <dt>{{ t('marketplace.workflows.author') }}</dt>
                  <dd>{{ card.author || '—' }}</dd>
                </div>
                <div class="mp-fact">
                  <dt>{{ t('marketplace.workflows.license') }}</dt>
                  <dd>{{ card.license || '—' }}</dd>
                </div>
                <div class="mp-fact">
                  <dt>{{ t('marketplace.workflows.size') }}</dt>
                  <dd>
                    {{ t('marketplace.workflows.nodes', { count: card.nodeCount ?? 0 }) }} ·
                    {{ t('marketplace.workflows.edges', { count: card.edgeCount ?? 0 }) }}
                  </dd>
                </div>
                <div v-if="card.skill" class="mp-fact">
                  <dt>{{ t('marketplace.workflows.slashCommand') }}</dt>
                  <dd>
                    <code>/{{ card.skill.name }}</code>
                  </dd>
                </div>
                <div v-if="card.skill?.description" class="mp-fact">
                  <dt>{{ t('marketplace.workflows.skillManual') }}</dt>
                  <dd>{{ card.skill.description }}</dd>
                </div>
                <div v-if="card.capabilityKeys?.length" class="mp-fact">
                  <dt>{{ t('marketplace.workflows.capabilities') }}</dt>
                  <dd class="mp-fact-chips">
                    <span v-for="capKey in card.capabilityKeys" :key="capKey" class="mp-chip cap">
                      {{ t(capKey) }}
                    </span>
                  </dd>
                </div>
                <div v-if="card.nodeTypes?.length" class="mp-fact">
                  <dt>{{ t('marketplace.workflows.pipeline') }}</dt>
                  <dd class="mp-fact-chips">
                    <code v-for="nt in card.nodeTypes" :key="nt" class="mp-badge-code">
                      {{ formatNodeTypeLabel(nt) }}
                    </code>
                  </dd>
                </div>
                <div v-if="card.tags?.length" class="mp-fact">
                  <dt>{{ t('marketplace.workflows.tags') }}</dt>
                  <dd class="mp-fact-chips">
                    <span v-for="tag in card.tags" :key="tag" class="mp-chip tag">
                      #{{ tag }}
                    </span>
                  </dd>
                </div>
                <div v-if="card.installed" class="mp-fact">
                  <dt>{{ t('marketplace.workflows.status') }}</dt>
                  <dd>
                    {{
                      card.updatable
                        ? t('marketplace.workflows.updatable')
                        : t('marketplace.workflows.installedTag')
                    }}
                  </dd>
                </div>
                <div v-if="card.missingNodeTypes?.length" class="mp-fact">
                  <dt>{{ t('marketplace.workflows.missing') }}</dt>
                  <dd class="mp-missing">{{ card.missingNodeTypes.join(', ') }}</dd>
                </div>
              </dl>
              <p v-if="card.blockReason === 'appTooOld'" class="mp-hint error">
                {{ t('marketplace.workflows.reason.appTooOld') }}
              </p>
              <p v-else-if="card.missingNodeTypes?.length" class="mp-hint error">
                {{ t('marketplace.workflows.missingHint') }}
              </p>
              <p v-if="card.installed" class="mp-hint">
                {{ t('marketplace.workflows.useInChatHint') }}
              </p>
              <!--
                技能包说明：让「装之前」和「装之后」都能看清 agent 会拿到什么。
                含脚本时**必须**明说脚本是会被执行的代码、安装时会单独确认一次 ——
                否则用户会以为脚本悄悄跟着说明书一起装进来了（或反过来以为永远不会装）。
              -->
              <p v-if="card.skill" class="mp-hint">
                {{ t('marketplace.workflows.skillDetail', { name: card.skill.name }) }}
              </p>
              <p v-if="skillHasScripts(card.skill)" class="mp-hint error">
                {{
                  t('marketplace.workflows.skillScriptsNote', {
                    count: skillScriptPaths(card.skill).length
                  })
                }}
              </p>
            </template>
            <template v-else>
              <p class="mp-hint">{{ t('marketplace.readOnlyHint') }}</p>
            </template>
          </div>
        </li>
      </ul>

      <p v-else class="mp-hint">
        {{ query.trim() ? t('marketplace.noMatch') : t('marketplace.empty') }}
      </p>

      <!--
        目录级操作只在该页签下出现。
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
        </div>
        <p class="mp-hint">
          {{ t('settings.skills.hint') }}
        </p>
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
  GitHubDiscoveredSkillView,
  McpBlenderBridgeInfo,
  McpServerInfo,
  SkillMarketEntryView
} from '@shared/ipc'
import type { AppSettings } from '@shared/domain'
import { DEFAULT_SETTINGS } from '@shared/domain'
import type { ExternalMcpServer } from '@shared/externalMcp'
import { listNodeTypes } from '@shared/graph'
import {
  checkSkillRuntimeDependencies,
  type SkillRuntimeDependencyReport
} from '@shared/claudeSkill'
import { plainSkillManifest, skillCategoryKey } from '@shared/skillMarket'
import { toPlain } from '../utils/toPlain'
import { useStudioI18n } from '../composables/useStudioI18n'
import { promptConfirm } from '../composables/useStudioPrompt'
import McpServerCard from '../components/marketplace/McpServerCard.vue'
import McpBlenderCard from '../components/marketplace/McpBlenderCard.vue'
import ExternalMcpConfig from '../components/marketplace/ExternalMcpConfig.vue'
import ExternalMcpAddDialog from '../components/marketplace/ExternalMcpAddDialog.vue'
import {
  buildMarketplaceCards,
  cardHasExecutableCode,
  countByCategory,
  filterMarketplaceCards,
  marketplaceCardHeading,
  scriptConsentText,
  searchPlaceholderKey,
  skillHasScripts,
  skillScriptPaths,
  skillScriptsConsentText,
  type MarketplaceCard,
  type MarketplaceFilter
} from '../features/marketplace/buildMarketplaceCards'

/**
 * 插件市场（独立窗口）。
 *
 * 四个页签：MCP / 技能 / 工作流，以及跨类的「全部」。其中**工作流来自远端市场**
 *（`ai-art-engine-skills`），其余是本地信息。
 *
 * 窗口本身是**应用级**（不依赖工程）；只有「使用工作流」会落到当前工程上，
 * 因此那一处会检查工程是否打开。
 *
 * 设置落盘要点：`setSettings` 是**整对象替换**，所以这里只把自己负责的片段
 * （`blenderMcp` / `externalMcp`）合并进「先读回来的最新设置」再写回；直接提交本地副本
 * 会覆盖掉另一个窗口刚改的模型 / 主题等字段。MCP 的端口与 token 不走这条路 ——
 * 它们由 `restartMcpServer` 独立热重启，不经过 `setSettings`。
 */

const { t } = useStudioI18n()

/**
 * 「开发者文档」按钮的目标：官网的**插件市场开发者文档**页（`website/developers.html`），
 * 不是用户手册。
 *
 * 作者要的是发布格式、技能包契约、脚本同意流、索引派生规则 —— 那些只在开发者文档里；
 * 用户手册讲的是「怎么用市场」。指向官网而不是 GitHub 源码页：文档已发布到站点，
 * 读者不必先会翻仓库；仓库里的 `docs/MARKETPLACE.md` 是同一份内容的源头（改要改两处）。
 * （这里没有「网页市场」：本仓库没有远端注册表，不做假入口。）
 */
const DEV_DOCS_URL = 'https://justin-sky.github.io/ai-art-engine/developers.html'
const TABS: MarketplaceFilter[] = ['all', 'mcp', 'skills']
const SAVE_DEBOUNCE_MS = 500

const mcp = ref<McpServerInfo | null>(null)
const skills = ref<DshSkillsInfo | null>(null)

/** GitHub 直接安装 Claude Code 技能状态 */
const githubUrl = ref('')
const githubInspecting = ref(false)
const githubInstalling = ref(false)
const githubError = ref('')
const githubOwnerRepo = ref('')
const githubRef = ref('')
const githubDiscovered = ref<GitHubDiscoveredSkillView[]>([])
const selectedGitHubSkillNames = ref<string[]>([])

const selectedGitHubSkills = computed(() =>
  githubDiscovered.value.filter((item) => selectedGitHubSkillNames.value.includes(item.name))
)

/** 远端技能市场（`ai-art-engine-skills`） */
const workflowEntries = ref<SkillMarketEntryView[]>([])
/** 目录来自磁盘缓存且本次刷新失败 → 界面提示「离线，数据可能过期」 */
const workflowStale = ref(false)
/** 实际取到数据的源地址与是否用了镜像（用户有权知道数据从哪来） */
const workflowSource = ref('')
const workflowUsedFallback = ref(false)
const workflowError = ref('')
/** 技能页签内的二级分类（'' = 全部） */
const workflowCategory = ref('')
/** 封面 data URL（按 id 懒加载） */
const workflowCovers = ref<Record<string, string>>({})
/** 一次最多预取多少张封面：避免一屏几十张一起发请求 */
const COVER_LAZY_LIMIT = 24
const workflowRefreshing = ref(false)
/**
 * 首次加载中（还没有任何条目）。
 *
 * 与 `workflowRefreshing` 分开：刷新时已经有内容可看，状态提示只需轻描淡写；
 * 首次加载时什么都没有，此时若显示「共 0 个工作流」会让人以为市场是空的 ——
 * 这个误解已经真实发生过一次。
 */
const workflowLoading = ref(false)
/** 刷新失败但有旧内容可看：给软提示，不要用错误把已有内容顶掉 */
const workflowRefreshFailed = ref(false)
const installingId = ref<string | null>(null)
const batchInstalling = ref(false)
const batchProgressDone = ref(0)
const batchProgressTotal = ref(0)

/** 可一键静默安装/升级的官方工作流（不含可执行代码与技能脚本且当前客户端无缺失节点依赖） */
const pendingSafeWorkflowEntries = computed(() =>
  workflowEntries.value.filter(
    (entry) =>
      (!entry.installed || entry.updatable) &&
      !entry.blockReason &&
      !entry.hasExecutableCode &&
      !entry.skill?.hasScripts
  )
)

const nodeTypeLabelMap = computed(() => {
  const map = new Map<string, string>()
  for (const def of listNodeTypes()) {
    const title = def.presentation?.defaultTitleKey
      ? t(def.presentation.defaultTitleKey)
      : def.defaultTitle
    map.set(def.typeId, title || def.label || def.typeId)
  }
  return map
})

function formatNodeTypeLabel(typeId: string): string {
  const title = nodeTypeLabelMap.value.get(typeId)
  return title && title !== typeId ? `${title} (${typeId})` : typeId
}

function skillDepReport(card: MarketplaceCard): SkillRuntimeDependencyReport {
  return checkSkillRuntimeDependencies({
    allowedTools: card.allowedTools,
    nodeTypes: card.nodeTypes,
    registeredNodeTypes: new Set(nodeTypeLabelMap.value.keys()),
    mcpRunning: mcp.value?.running ?? true,
    blenderConnected: mcp.value?.blenderBridge?.connected ?? true,
    configuredExternalMcpIds: externalMcp.value.filter((s) => s.enabled).map((s) => s.id)
  })
}

const category = ref<MarketplaceFilter>('all')
const query = ref('')
const openKey = ref('')
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

/** 技能页签下可选的二级分类：只列数据里真实出现过的（不摆空分类） */
const workflowCategories = computed(() => {
  const seen = new Set<string>()
  for (const entry of workflowEntries.value) seen.add(entry.category)
  return [...seen].sort()
})

/** 市场 id → 分类（二级筛选用；索引里已带，这里查本地副本） */
function categoryOfMarketId(marketId: string): string {
  return workflowEntries.value.find((entry) => entry.id === marketId)?.category ?? ''
}

const allCards = computed<MarketplaceCard[]>(() => {
  // 已随远端市场条目附带的技能名集合：避免安装后在同一个「技能」页签下出现重复卡片
  const bundledSkillNames = new Set(
    workflowEntries.value
      .map((entry) => entry.skill?.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0)
  )
  const dedupedSkills = skills.value
    ? {
        ...skills.value,
        files: skills.value.files.filter(
          (file) => !(file.kind === 'bundle' && bundledSkillNames.has(file.fileName))
        )
      }
    : null
  return buildMarketplaceCards({
    mcp: mcp.value,
    skills: dedupedSkills,
    workflows: workflowEntries.value,
    external: externalMcp.value
  })
})
const counts = computed<Record<MarketplaceFilter, number>>(() => {
  const raw = countByCategory(allCards.value)
  return {
    all: raw.all,
    mcp: raw.mcp,
    skills: raw.skills + raw.workflows,
    workflows: raw.workflows
  }
})
const cards = computed(() => {
  const filtered =
    category.value === 'skills'
      ? filterMarketplaceCards(allCards.value, {
          category: 'all',
          query: query.value
        }).filter((card) => card.category === 'skills' || card.category === 'workflows')
      : filterMarketplaceCards(allCards.value, {
          category: category.value,
          query: query.value
        })
  // 二级分类只在技能页签生效；其余页签不受影响
  if (category.value !== 'skills' || !workflowCategory.value) return filtered
  return filtered.filter(
    (card) => card.marketId && categoryOfMarketId(card.marketId) === workflowCategory.value
  )
})
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
      /**
       * 必须深拷成纯数据：`{ ...server }` 只剥掉最外层代理，`headers` / `env` 这些
       * 嵌套对象仍是响应式代理，过 IPC 会抛 `DataCloneError`（"An object could not be cloned"）。
       */
      externalMcp: externalMcp.value.map((server) => toPlain(server))
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
  // 删除是不可逆的（凭据一起没了），当场确认一次；用应用自己的弹窗，别用原生的系统对话框
  const ok = await promptConfirm({
    title: t('marketplace.ext.remove'),
    message: t('marketplace.ext.removeConfirm', { name: target.name }),
    confirmLabel: t('marketplace.ext.remove')
  })
  if (!ok) return
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
  // 工作流：封面缺失时的回落图标
  return '⛓'
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
    // 同 persistExternal：嵌套对象也要剥成纯数据，否则过 IPC 会抛 DataCloneError
    const saved = await window.studio.setSettings({ ...latest, blenderMcp: toPlain(blenderMcp) })
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

function canUninstallSkillCard(card: MarketplaceCard): boolean {
  return (
    card.sourceKey === 'marketplace.source.skill.github' ||
    card.sourceKey === 'marketplace.source.skill.custom' ||
    card.sourceKey === 'marketplace.source.skill.template'
  )
}

async function uninstallLocalSkill(card: MarketplaceCard): Promise<void> {
  let ok = false
  try {
    ok = await promptConfirm({
      title: t('marketplace.workflows.uninstall'),
      message: t('marketplace.workflows.uninstallConfirm', {
        title: card.title ?? card.identifier
      }),
      confirmLabel: t('marketplace.workflows.uninstall')
    })
  } catch (e) {
    isError.value = true
    message.value = e instanceof Error ? e.message : String(e)
    return
  }
  if (!ok) return
  busy.value = true
  isError.value = false
  try {
    const res = await window.studio.uninstallSkill(card.identifier)
    if (!res.ok) {
      isError.value = true
      message.value = res.error ?? t('marketplace.workflows.reason.removeFailed')
      return
    }
    message.value = t('marketplace.workflows.uninstalled', {
      title: card.title ?? card.identifier
    })
    if (openKey.value === card.key) openKey.value = ''
    await refreshSkills()
  } catch (e) {
    isError.value = true
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

function clearGitHubInspect(): void {
  githubDiscovered.value = []
  selectedGitHubSkillNames.value = []
  githubOwnerRepo.value = ''
  githubRef.value = ''
  githubError.value = ''
}

function toggleGitHubSkillSelection(name: string): void {
  if (selectedGitHubSkillNames.value.includes(name)) {
    selectedGitHubSkillNames.value = selectedGitHubSkillNames.value.filter((n) => n !== name)
  } else {
    selectedGitHubSkillNames.value = [...selectedGitHubSkillNames.value, name]
  }
}

async function inspectGitHubSkills(): Promise<void> {
  const url = githubUrl.value.trim()
  if (!url || githubInspecting.value) return
  githubInspecting.value = true
  githubError.value = ''
  githubDiscovered.value = []
  selectedGitHubSkillNames.value = []
  try {
    const res = await window.studio.inspectGitHubSkills({ url })
    if (!res.ok || !res.skills?.length) {
      githubError.value = t(`marketplace.github.reason.${res.reasonKey ?? 'noSkillsFound'}`)
      return
    }
    githubOwnerRepo.value = res.source ? `${res.source.owner}/${res.source.repo}` : url
    githubRef.value = res.source?.resolvedRef ?? ''
    githubDiscovered.value = res.skills
    selectedGitHubSkillNames.value = res.skills.map((s) => s.name)
  } catch (e) {
    githubError.value = e instanceof Error ? e.message : String(e)
  } finally {
    githubInspecting.value = false
  }
}

async function installSelectedGitHubSkills(): Promise<void> {
  const url = githubUrl.value.trim()
  const chosen = selectedGitHubSkills.value
  if (!url || !chosen.length || githubInstalling.value) return

  let skillScriptsConsent = false
  try {
    const allScripts: string[] = []
    for (const item of chosen) {
      for (const f of item.files) {
        if (f.path.startsWith('scripts/')) allScripts.push(`${item.name}/${f.path}`)
      }
    }
    if (allScripts.length > 0 || chosen.some((s) => s.hasScripts)) {
      skillScriptsConsent = await promptConfirm({
        title: t('marketplace.workflows.skillWithScripts'),
        message: t('marketplace.workflows.scriptsConfirm', {
          count: allScripts.length,
          files: allScripts.join('\n')
        }),
        confirmLabel: t('marketplace.workflows.install')
      })
    }
  } catch (e) {
    isError.value = true
    message.value = e instanceof Error ? e.message : String(e)
    return
  }

  githubInstalling.value = true
  isError.value = false
  try {
    const res = await window.studio.installGitHubSkills({
      url,
      skillNames: chosen.map((s) => s.name),
      skillScriptsConsent
    })
    if (!res.ok) {
      isError.value = true
      message.value = t(`marketplace.github.reason.${res.reasonKey ?? 'unknown'}`)
      return
    }
    const installedNames = (res.installed ?? []).join(', ')
    message.value = t('marketplace.github.installedOk', {
      count: res.installed?.length ?? chosen.length,
      names: installedNames
    })
    clearGitHubInspect()
    githubUrl.value = ''
    await refreshSkills()
  } catch (e) {
    isError.value = true
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    githubInstalling.value = false
  }
}

async function refreshSkills(): Promise<void> {
  try {
    skills.value = await window.studio.getDshSkillsInfo()
  } catch (e) {
    isError.value = true
    message.value = e instanceof Error ? e.message : String(e)
  }
}

/** 拉工作流市场目录。`force` 用于用户手动刷新（跳过 1 小时 TTL）。 */
/**
 * 拉工作流市场目录。
 *
 * **每次打开市场窗口都会强制刷新**（`onMounted` 传 `force`）—— 往仓库推了新工作流后重开窗口
 * 就能看到，不必等 1 小时 TTL，也不必手点「刷新目录」。
 */
async function loadWorkflowCatalog(
  force = false,
  options: { silent?: boolean } = {}
): Promise<void> {
  /**
   * `silent`：安装 / 卸载之后的**后台**刷新。
   *
   * 「刷新目录」按钮的文字与禁用态都由 `workflowRefreshing` 驱动，所以后台刷新一旦点亮它，
   * 用户看到的就是「我点的是安装，怎么刷新按钮自己转起来了」——把动作归属搞错了。
   * 后台刷新不该借用用户手动刷新的状态表达。
   */
  if (!options.silent) workflowRefreshing.value = true
  if (workflowEntries.value.length === 0) workflowLoading.value = true
  try {
    const result = await window.studio.fetchSkillMarket({ force })
    if (!result.ok) {
      /**
       * 失败时**保留已有条目**。首次加载失败给硬错误；刷新失败但手上有旧内容时只给软提示 ——
       * 用错误把已经有内容的列表顶掉，等于把「暂时刷不到新的」夸大成「什么都没有」。
       */
      const reason = t(`marketplace.workflows.reason.${result.reasonKey ?? 'network'}`)
      if (workflowEntries.value.length > 0) {
        workflowRefreshFailed.value = true
        workflowError.value = ''
      } else {
        workflowError.value = reason
      }
      return
    }
    workflowEntries.value = result.entries ?? []
    workflowStale.value = !!result.stale
    workflowSource.value = result.source ?? ''
    workflowUsedFallback.value = !!result.usedFallback
    workflowRefreshFailed.value = false
    workflowError.value = result.stale
      ? t('marketplace.workflows.offline')
      : result.dropped
        ? t('marketplace.workflows.dropped', { count: result.dropped })
        : ''
    // 封面按需拉（只拉当前可见分类的前若干张，避免一次性打几百个请求）
    void loadVisibleCovers()
  } catch (e) {
    if (workflowEntries.value.length > 0) {
      workflowRefreshFailed.value = true
    } else {
      workflowError.value = e instanceof Error ? e.message : String(e)
    }
  } finally {
    if (!options.silent) workflowRefreshing.value = false
    workflowLoading.value = false
  }
}

/**
 * 丢掉某条（或全部）已缓存的封面，让下次 `loadVisibleCovers()` 重新去取。
 *
 * 两份缓存都要清才有效：本文件的 `workflowCovers` **只拉还没有封面的条目**，
 * 而主进程那边还有一份 `coverMemo`（安装 / 卸载时由主进程自己失效）。
 * 装完 / 卸完 / 手动刷新目录之后不清这里，界面上会继续显示旧封面 ——
 * 用户看到的现象就是「重装了还是没有封面」。
 */
function invalidateCovers(ids?: string[]): void {
  if (!ids) {
    workflowCovers.value = {}
    return
  }
  const next = { ...workflowCovers.value }
  for (const id of ids) delete next[id]
  workflowCovers.value = next
}

/**
 * 手动「刷新目录」：**连同封面缓存一起丢**。
 *
 * 用户按这个按钮就是要「重新去远端拿一遍」—— 目录拉新的而封面还用旧的，
 * 会出现「目录里明明换了封面，界面上还是老图」这种说不清的状态。
 * 后台刷新（安装 / 卸载后的静默刷新）不走这里，只丢受影响的那一条。
 */
async function refreshWorkflowCatalog(): Promise<void> {
  invalidateCovers()
  await loadWorkflowCatalog(true)
}

/** 懒加载封面：只拉还没有封面且在当前筛选结果里的条目 */
async function loadVisibleCovers(): Promise<void> {
  const pending = cards.value
    .filter((card) => card.marketId && !workflowCovers.value[card.marketId])
    .slice(0, COVER_LAZY_LIMIT)
  await Promise.all(
    pending.map(async (card) => {
      const id = card.marketId!
      const result = await window.studio.fetchSkillCover(id)
      if (result.ok && result.dataUrl) {
        workflowCovers.value = { ...workflowCovers.value, [id]: result.dataUrl }
      }
    })
  )
}

/** 安装（或更新）：缺依赖时先拦一次，含脚本时再要一次明示同意，之后才带逃生门重试 */
async function installMarketWorkflow(card: MarketplaceCard): Promise<void> {
  const id = card.marketId
  if (!id) return
  /**
   * 只挡**同一张卡**的重复点击。
   *
   * 早先是 `if (installingId.value) return` —— 于是任何一张卡在装（尤其卡在安装后重新拉目录
   * 那一步，最坏要等两个源各自超时）时，**其它所有卡的安装按钮都会静默失效**：
   * 点了没有任何反应、也没有任何提示，看起来就是「按钮坏了」。
   */
  if (installingId.value === id) return

  let missing: string[] = []
  let withScripts = false
  let scriptsConsented = false
  let scriptConsented = false
  try {
    /**
     * 确认框一律用应用自己的 `promptConfirm`，**不要用 `window.confirm`**。
     *
     * 原生弹窗是 Chromium 的系统对话框，与应用完全不是一个样式（也不跟主题走），
     * 在市场窗口里尤其突兀。`promptConfirm` 的正文是 `white-space: pre-wrap`，
     * 所以下面那份逐行列出的脚本清单能原样换行显示。
     *
     * 两个确认都在 `try` 里：弹窗实现一旦抛错（或宿主拒绝弹窗），异常不能从 async
     * 事件处理器直接逃出去 —— 那样表现为「点了完全没反应」，连原因都看不到。
     */
    missing = card.missingNodeTypes ?? []
    if (missing.length > 0) {
      const ok = await promptConfirm({
        title: t('marketplace.workflows.missing'),
        message: t('marketplace.workflows.missingConfirm', { types: missing.join(', ') }),
        confirmLabel: t('marketplace.workflows.install')
      })
      if (!ok) return
    }
    /**
     * 含脚本的技能包必须**逐次**确认（哪怕上次同意过、哪怕只是「重新安装」）：
     * `scripts/` 是会被 agent 在本机执行起来的代码，同意应当是每次安装的独立决定，
     * 而不是一个装过一次就永久生效的开关。
     *
     * 确认框里的「取消」= **不装脚本**（说明书与 references 照常装上，工作流可用）——
     * 这正是主进程在缺少 `skillScriptsConsent` 时的行为，因此不需要再走一条分支。
     */
    withScripts = skillHasScripts(card.skill)
    scriptsConsented =
      withScripts && card.skill
        ? await promptConfirm({
            title: t('marketplace.workflows.skillWithScripts'),
            message: skillScriptsConsentText(card.skill, (key, named) => t(key, named)),
            confirmLabel: t('marketplace.workflows.install')
          })
        : false
    /**
     * 含可执行代码（script.run）的工作流也**逐次**确认，但与技能脚本不同：
     * 这里的「取消」= **不安装整条工作流**（代码就是工作流的一部分，不能像技能脚本那样
     * 「只跳过脚本、照装其余」）。主进程缺 `scriptConsent === true` 时同样会拒绝安装，
     * 界面在这里提前把脚本清单摆出来，取消就直接返回、什么都不装。
     */
    if (cardHasExecutableCode(card)) {
      scriptConsented = await promptConfirm({
        title: t('marketplace.workflows.executableCode'),
        message: scriptConsentText(card.scripts ?? [], (key, named) => t(key, named)),
        confirmLabel: t('marketplace.workflows.install')
      })
      if (!scriptConsented) return
    }
  } catch (e) {
    isError.value = true
    message.value = e instanceof Error ? e.message : String(e)
    return
  }

  installingId.value = id
  try {
    const result = await window.studio.installSkillMarket({
      id,
      acceptMissingTypes: missing.length > 0,
      // 把用户点的这条条目里的技能清单原样带过去：主进程会重新校验，
      // 但「装哪个技能」必须与卡片上写的一致，否则界面就在骗人。
      // 必须转成纯数据：卡片上的 skill 是 Vue 响应式代理，代理过不了 IPC 的结构化克隆
      ...(card.skill ? { skill: plainSkillManifest(card.skill) } : {}),
      // Semantic Pack 清单也要转成纯数据（避免 Vue 代理过不了 IPC）
      ...(card.semanticPacks
        ? {
            semanticPacks: {
              files: card.semanticPacks.files.map((f) => ({
                path: f.path,
                ...(typeof f.sizeBytes === 'number' ? { sizeBytes: f.sizeBytes } : {})
              })),
              ...(typeof card.semanticPacks.sizeBytes === 'number'
                ? { sizeBytes: card.semanticPacks.sizeBytes }
                : {})
            }
          }
        : {}),
      // 只有用户在上面的确认框里点了「确定」才为 true；主进程只认字面量 true
      ...(scriptsConsented ? { skillScriptsConsent: true } : {}),
      // 含可执行代码的工作流：用户逐次同意后才带上；主进程同样只认字面量 true
      ...(scriptConsented ? { scriptConsent: true } : {})
    })
    if (!result.ok) {
      isError.value = true
      message.value = t(`marketplace.workflows.reason.${result.reasonKey ?? 'download'}`)
      return
    }
    // 明确告诉用户这次没装脚本：否则「脚本怎么没生效」会变成一条查不出来的线索
    message.value =
      withScripts && !scriptsConsented
        ? t('marketplace.workflows.installedWithoutScripts', { title: card.title ?? id })
        : t('marketplace.workflows.installed', { title: card.title ?? id })
    isError.value = false
    /**
     * 安装完刷新目录是**后台**动作，两个要点：
     *
     * 1. `silent: true` —— 不能点亮「刷新目录」按钮。那个按钮的文字/禁用态就是
     *    `workflowRefreshing`，被后台刷新点亮会让用户以为「我点安装，怎么刷新被触发了」。
     * 2. 放在 `finally` 之前 —— 让这张卡一直显示「安装中…」，直到列表真的更新完。
     *    安装动作的进度该由安装按钮表达，而不是借刷新按钮表达。
     */
    try {
      // 刚装上的那条会把新的 cover.png 落到本地，缓存里的旧封面必须丢掉才会重取
      invalidateCovers([id])
      await loadWorkflowCatalog(true, { silent: true })
      await refreshSkills()
    } catch {
      // 列表刷新失败不该把「已安装」翻成报错：主进程确实装好了，失败的只是刷新
    }
  } catch (e) {
    isError.value = true
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    installingId.value = null
  }
}

async function uninstallMarketWorkflow(card: MarketplaceCard): Promise<void> {
  const id = card.marketId
  if (!id) return
  /**
   * 用应用自己的 `promptConfirm`，**不用 `window.confirm`**：原生弹窗是 Chromium 的系统
   * 对话框，样式与应用无关（也不跟主题走），卸载这种带副作用的操作更应该用一致的样式说清楚。
   *
   * 仍放在 `try` 里：弹窗一旦抛错，异常会从 async 函数直接逃出去，表现为「点了没反应」。
   */
  let ok = false
  try {
    ok = await promptConfirm({
      title: t('marketplace.workflows.uninstall'),
      message: t('marketplace.workflows.uninstallConfirm', { title: card.title ?? id }),
      confirmLabel: t('marketplace.workflows.uninstall')
    })
  } catch (e) {
    isError.value = true
    message.value = e instanceof Error ? e.message : String(e)
    return
  }
  if (!ok) return
  const result = await window.studio.uninstallSkillMarket(id)
  if (!result.ok) {
    isError.value = true
    message.value = t(`marketplace.workflows.reason.${result.reasonKey ?? 'download'}`)
    return
  }
  message.value = t('marketplace.workflows.uninstalled', { title: card.title ?? id })
  isError.value = false
  // 卸掉本地副本后封面要重新走远端（否则会一直用那份已经删掉的本地图），同样不点亮刷新按钮
  invalidateCovers([id])
  // 后台刷新，同样不点亮「刷新目录」按钮（理由见 installMarketWorkflow）
  await loadWorkflowCatalog(true, { silent: true })
  await refreshSkills()
}

/**
 * 批量同步所有无需脚本确认且无缺失依赖的官方工作流与技能。
 */
async function installAllSafeWorkflows(): Promise<void> {
  const targets = pendingSafeWorkflowEntries.value
  if (!targets.length || batchInstalling.value) return
  batchInstalling.value = true
  batchProgressDone.value = 0
  batchProgressTotal.value = targets.length
  isError.value = false
  let okCount = 0
  const updatedIds: string[] = []
  try {
    for (const entry of targets) {
      const res = await window.studio.installSkillMarket({
        id: entry.id,
        ...(entry.skill ? { skill: plainSkillManifest(entry.skill) } : {}),
        ...(entry.semanticPacks
          ? {
              semanticPacks: {
                files: entry.semanticPacks.files.map((f) => ({
                  path: f.path,
                  ...(typeof f.sizeBytes === 'number' ? { sizeBytes: f.sizeBytes } : {})
                })),
                ...(typeof entry.semanticPacks.sizeBytes === 'number'
                  ? { sizeBytes: entry.semanticPacks.sizeBytes }
                  : {})
              }
            }
          : {})
      })
      batchProgressDone.value += 1
      if (res.ok) {
        okCount += 1
        updatedIds.push(entry.id)
      }
    }
    invalidateCovers(updatedIds)
    await loadWorkflowCatalog(true, { silent: true })
    await refreshSkills()
    message.value = t('marketplace.workflows.installedAll', { count: okCount })
  } catch (e) {
    isError.value = true
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    batchInstalling.value = false
  }
}

async function copySlashCommand(skillName: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(`/${skillName} `)
    isError.value = false
    message.value = t('marketplace.workflows.copiedSlash', { name: skillName })
  } catch (e) {
    isError.value = true
    message.value = e instanceof Error ? e.message : String(e)
  }
}

/**
 * 市场的职责到「装到本机」为止：**使用**（把工作流落进工程）放在 AI 对话里 ——
 * 那里才有「要做哪条工作流、还要补什么要求」的上下文。
 * 因此卡片上只有 安装 / 卸载，没有「使用」按钮。
 */

onMounted(async () => {
  try {
    const [mcpInfo, skillsData, settings] = await Promise.all([
      window.studio.getMcpInfo(),
      window.studio.getDshSkillsInfo(),
      window.studio.getSettings()
    ])
    mcp.value = mcpInfo
    skills.value = skillsData
    Object.assign(blenderMcp, settings.blenderMcp)
    externalMcp.value = settings.externalMcp ?? []
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
  // 目录单独拉：它依赖网络，不该把其余本地信息一起拖住（本地部分先渲染出来）。
  // **强制刷新**：市场窗口每次打开都反映远端现状，不用等 TTL，也不用用户手点刷新。
  await loadWorkflowCatalog(true)
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

/*
  封面：固定 16:9 尺寸盒，避免图片到达时撑开卡片（CLS）。
  object-fit: cover 让不同比例的封面都不变形。
*/
.mp-card-cover {
  flex-shrink: 0;
  width: 88px;
  aspect-ratio: 16 / 9;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-hover);
  object-fit: cover;
}

/* 工作流二级分类条：与一级页签同一视觉，只是间距更紧 */
.mp-subtabs {
  margin-top: -4px;
}

.mp-card-byline {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mp-missing {
  color: var(--danger-muted);
}

.mp-btn.danger {
  color: var(--danger-muted);
  border-color: color-mix(in srgb, var(--danger) 45%, transparent);
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

/* 含脚本的技能包：需要用户留意，不能与普通状态一样是灰的 */
.mp-card-state.warn {
  color: var(--warning);
}

.mp-card-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/*
  把「详情 / 收起」推到行尾，与安装 / 使用 / 卸载拉开距离。
  卸载紧挨着使用容易误点（虽然卸载有二次确认，但误点本身就不该发生）。
*/
.mp-btn-push-end {
  margin-left: auto;
}

.mp-detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

/* 详情里的键值对（技能：文件 / 用途 / 来源） */
.mp-facts {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
}

.mp-fact {
  display: flex;
  gap: 8px;
  font-size: 12px;
  min-width: 0;
}

.mp-fact dt {
  flex-shrink: 0;
  width: 56px;
  color: var(--text-muted);
}

.mp-fact dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}

.mp-fact code {
  font-family: var(--mono);
  font-size: 11px;
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

.mp-github-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
}

.mp-github-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mp-github-bar input {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
  font-family: var(--mono);
}

.mp-github-results {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.mp-github-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
}

.mp-github-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
  overflow-y: auto;
}

.mp-github-item {
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
}

.mp-github-check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  cursor: pointer;
}

.mp-github-item-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}

.mp-github-item-top {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.mp-badge-code {
  display: inline-block;
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid var(--border);
  background: var(--bg-hover);
  font-family: var(--mono);
  font-size: 10px;
  color: var(--text-muted);
}

.mp-card-chips,
.mp-fact-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-items: center;
}

.mp-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 1.35;
  border: 1px solid var(--border);
  background: var(--bg-hover);
  color: var(--text-muted);
}

.mp-chip.cap {
  border-color: rgba(90, 157, 255, 0.38);
  background: rgba(90, 157, 255, 0.12);
  color: #7ab3ff;
  font-weight: 500;
}

.mp-chip.tag {
  font-size: 10.5px;
  opacity: 0.9;
}
</style>
