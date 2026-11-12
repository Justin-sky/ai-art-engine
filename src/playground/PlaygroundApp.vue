<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  MX_TEMPLATES,
  createMxFromTemplate,
  exportMxForecastCsv,
  exportMxGodotGd,
  exportMxRunCsv,
  exportMxToMermaid,
  exportMxUnityCs,
  normalizeMxDocument,
  type MxDocument,
  type MxTemplateId
} from '@shared/gameAssets'
import { applyAppTheme, themePreference } from '@renderer/editor/preferences'
import {
  createMxStudioStore,
  provideMxStudioStore,
  type MxDrawer as MxDrawerKind
} from '@renderer/components/dive/machinations/mxStudioStore'
import MxCanvas from '@renderer/components/dive/machinations/MxCanvas.vue'
import MxDrawer from '@renderer/components/dive/machinations/MxDrawer.vue'
import MxInspector from '@renderer/components/dive/machinations/MxInspector.vue'
import MxResultsPanel from '@renderer/components/dive/machinations/MxResultsPanel.vue'
import MxFormulaModal from '@renderer/components/dive/machinations/MxFormulaModal.vue'
import MxFloatingTip from '@renderer/components/dive/machinations/MxFloatingTip.vue'
import FullVersionPromptModal, { type FullAppPromptReason } from './FullVersionPromptModal.vue'
import { setPlaygroundLocale, type PlaygroundLocale } from './i18n'

const { t, locale } = useI18n()

const isEn = computed(() =>
  String(locale.value || '')
    .toLowerCase()
    .startsWith('en')
)

const DOC_STORAGE_KEY = 'aiae.playground.mxDoc.v1'
const PRESET_STORAGE_KEY = 'aiae.playground.preset.v1'
const TIP_DISMISSED_KEY = 'aiae.playground.tipDismissed.v1'
const DEFAULT_PRESET: MxTemplateId = 'roguelike_mana_deck'

const QUICK_PRESETS: Array<{ id: MxTemplateId; labelKey: string }> = [
  { id: 'roguelike_mana_deck', labelKey: 'playground.presets.deck' },
  { id: 'balatro_ante_jokers', labelKey: 'playground.presets.balatro' },
  { id: 'gacha_pity_banner', labelKey: 'playground.presets.gacha' },
  { id: 'survivor_xp_loop', labelKey: 'playground.presets.survivor' },
  { id: 'onmyoji_speed_orbs', labelKey: 'playground.presets.onmyoji' },
  { id: 'tower_defense_waves', labelKey: 'playground.presets.tower' },
  { id: 'idle_exponential_tycoon', labelKey: 'playground.presets.idle' }
]

function isValidTemplateId(id: string): id is MxTemplateId {
  return MX_TEMPLATES.some((tpl) => tpl.id === id)
}

function resolveInitialState(): { doc: MxDocument; presetId: MxTemplateId; fromUrl: boolean } {
  const params = new URLSearchParams(window.location.search)
  const urlTpl = (params.get('template') || params.get('preset') || '').trim()
  if (urlTpl && isValidTemplateId(urlTpl)) {
    return {
      doc: createMxFromTemplate(urlTpl),
      presetId: urlTpl,
      fromUrl: true
    }
  }

  try {
    const rawSaved = localStorage.getItem(DOC_STORAGE_KEY)
    const savedPreset = (localStorage.getItem(PRESET_STORAGE_KEY) || '').trim()
    const presetId = isValidTemplateId(savedPreset) ? savedPreset : DEFAULT_PRESET
    if (rawSaved) {
      const parsed = normalizeMxDocument(JSON.parse(rawSaved))
      if (parsed.nodes.length > 0) {
        return { doc: parsed, presetId, fromUrl: false }
      }
    }
  } catch {
    // ignore corrupted cache
  }

  return {
    doc: createMxFromTemplate(DEFAULT_PRESET),
    presetId: DEFAULT_PRESET,
    fromUrl: false
  }
}

const initialState = resolveInitialState()
const activePresetId = ref<MxTemplateId>(initialState.presetId)
const store = createMxStudioStore(initialState.doc)
if (store.complexityMode.value === 'simple') {
  store.switchComplexityMode('simple', true)
}
provideMxStudioStore(store)

const canvasRef = ref<InstanceType<typeof MxCanvas> | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const exportOpen = ref(false)
const downstreamOpen = ref(false)
const linkCopied = ref(false)
const showTipBanner = ref(true)

try {
  if (sessionStorage.getItem(TIP_DISMISSED_KEY) === '1') {
    showTipBanner.value = false
  }
} catch {
  // ignore sessionStorage error
}

const promptOpen = ref(false)
const promptReason = ref<FullAppPromptReason>('cta')
const promptTargetLabel = ref<string | undefined>(undefined)

interface PlaygroundToast {
  title: string
  body?: string
  showUpgradeAction?: boolean
}
const activeToast = ref<PlaygroundToast | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(next: PlaygroundToast, durationMs = 8500): void {
  activeToast.value = next
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    activeToast.value = null
  }, durationMs)
}

function openFullAppPrompt(reason: FullAppPromptReason, targetLabel?: string): void {
  exportOpen.value = false
  downstreamOpen.value = false
  promptReason.value = reason
  promptTargetLabel.value = targetLabel
  promptOpen.value = true
}

function dismissTipBanner(): void {
  showTipBanner.value = false
  try {
    sessionStorage.setItem(TIP_DISMISSED_KEY, '1')
  } catch {
    // ignore
  }
}

const homeHref = computed(() => (isEn.value ? '../index.en.html' : '../index.html'))

function toggleLanguage(): void {
  const next: PlaygroundLocale = isEn.value ? 'zh-CN' : 'en-US'
  setPlaygroundLocale(next)
}

function toggleSiteTheme(): void {
  const next = themePreference.value === 'dark' ? 'light' : 'dark'
  applyAppTheme(next)
  store.canvasTheme.value = 'auto'
  try {
    localStorage.setItem('site.theme', next)
  } catch {
    // ignore
  }
}

function selectQuickPreset(tplId: MxTemplateId): void {
  activePresetId.value = tplId
  const nextDoc = createMxFromTemplate(tplId)
  store.replaceDoc(nextDoc)
  store.playAgain()
  try {
    localStorage.setItem(PRESET_STORAGE_KEY, tplId)
    const url = new URL(window.location.href)
    url.searchParams.set('template', tplId)
    window.history.replaceState(null, '', url.toString())
  } catch {
    // ignore
  }
  setTimeout(() => canvasRef.value?.fitToScreen(), 35)
}

function resetCurrentPreset(): void {
  selectQuickPreset(activePresetId.value)
}

function openPlayableHudTab(): void {
  store.resultsTab.value = 'playable'
  store.resultsOpen.value = true
  if (!store.runs.value.length) {
    store.playAgain()
  }
}

function openCurveGoalSeekTab(): void {
  store.resultsTab.value = 'results'
  store.resultsOpen.value = true
  if (!store.runs.value.length) {
    store.playAgain()
  }
}

async function copyShareUrl(): Promise<void> {
  try {
    const url = new URL(window.location.href)
    url.searchParams.set('template', activePresetId.value)
    if (isEn.value) url.searchParams.set('lang', 'en')
    else url.searchParams.delete('lang')
    await navigator.clipboard.writeText(url.toString())
    linkCopied.value = true
    exportOpen.value = false
    setTimeout(() => {
      linkCopied.value = false
    }, 1800)
  } catch {
    // ignore
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => [store.docRevision.value, store.isCanvasDragging.value] as const,
  ([, dragging]) => {
    if (dragging) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(DOC_STORAGE_KEY, JSON.stringify(store.doc.value))
      } catch {
        // ignore quota errors
      }
    }, 320)
  }
)

watch(
  isEn,
  (en) => {
    document.title = en
      ? 'Game Mechanics & Economy Playground (Machinations v2) — AI Art Engine'
      : 'AI Art Engine 在线试玩沙盘 — 游戏机制与经济数值仿真 (Machinations v2)' // cjk-ok
  },
  { immediate: true }
)

onMounted(() => {
  try {
    const savedTheme = localStorage.getItem('site.theme')
    const prefersLight =
      savedTheme === 'light' ||
      (savedTheme === 'auto' && !window.matchMedia('(prefers-color-scheme: dark)').matches)
    applyAppTheme(prefersLight ? 'light' : 'dark')
  } catch {
    applyAppTheme('dark')
  }

  const params = new URLSearchParams(window.location.search)
  const tabParam = (params.get('tab') || '').trim().toLowerCase()
  const modeParam = (params.get('mode') || '').trim().toLowerCase()
  if (modeParam === 'pro') {
    store.switchComplexityMode('pro', false)
  } else if (modeParam === 'simple') {
    store.switchComplexityMode('simple', false)
  }

  if (!store.runs.value.length) {
    store.playAgain()
  }
  if (tabParam === 'playable') {
    store.resultsTab.value = 'playable'
    store.resultsOpen.value = true
  } else if (tabParam === 'balancer') {
    store.resultsTab.value = 'balancer'
    store.resultsOpen.value = true
  } else if (tabParam === 'diagnostics') {
    store.resultsTab.value = 'diagnostics'
    store.resultsOpen.value = true
  }

  setTimeout(() => canvasRef.value?.fitToScreen(), 55)
})

onBeforeUnmount(() => {
  store.stopTimer()
  if (saveTimer) clearTimeout(saveTimer)
  if (toastTimer) clearTimeout(toastTimer)
})

const navItems: Array<{ id: Exclude<MxDrawerKind, ''>; icon: string; labelKey: string }> = [
  { id: 'agents', icon: '🤖', labelKey: 'mx.nav.agents' },
  { id: 'templates', icon: '⊞', labelKey: 'mx.nav.templates' },
  { id: 'blocks', icon: '❖', labelKey: 'mx.nav.blocks' },
  { id: 'resources', icon: '◉', labelKey: 'mx.nav.resources' },
  { id: 'params', icon: '(x)', labelKey: 'mx.nav.params' },
  { id: 'layers', icon: '☰', labelKey: 'mx.nav.layers' },
  { id: 'clips', icon: '⧉', labelKey: 'mx.nav.clips' },
  { id: 'history', icon: '⟲', labelKey: 'mx.nav.history' },
  { id: 'docs', icon: '?', labelKey: 'mx.nav.docs' }
]

function toggleDrawer(id: Exclude<MxDrawerKind, ''>): void {
  store.drawer.value = store.drawer.value === id ? '' : id
  if (store.drawer.value === 'params') {
    store.ensureScenariosReady()
  }
}

const activeScenario = computed(
  () => store.doc.value.scenarios.find((sc) => sc.id === store.doc.value.activeScenarioId) ?? null
)

function getScenarioParamVal(paramName: string, fallback: number): number {
  if (!activeScenario.value) return fallback
  const ov = activeScenario.value.params[paramName]
  return Number.isFinite(ov) ? ov! : fallback
}

function updateScenarioParamVal(paramName: string, rawVal: string): void {
  const num = Number(rawVal)
  const val = Number.isFinite(num) ? num : 0
  store.mutate((d) => {
    if (d.activeScenarioId) {
      const sc = d.scenarios.find((x) => x.id === d.activeScenarioId)
      if (sc) sc.params[paramName] = val
    } else {
      const p = d.params.find((x) => x.name === paramName)
      if (p) p.value = val
    }
  }, `scParam:${paramName}`)
  store.runAllScenariosCompare()
}

function formatScenarioDelta(paramName: string, baseVal: number): string {
  if (!activeScenario.value || !baseVal) return ''
  const cur = getScenarioParamVal(paramName, baseVal)
  const diffPct = Math.round(((cur - baseVal) / Math.abs(baseVal)) * 100)
  if (diffPct === 0) return ''
  return diffPct > 0 ? `+${diffPct}%` : `${diffPct}%`
}

const safeSlug = computed(
  () =>
    (store.doc.value.title || 'machinations')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'diagram'
)

function downloadFile(filename: string, content: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  exportOpen.value = false
  showToast({
    title: t('playground.toast.exportedTitle', { file: filename }),
    body: t('playground.toast.exportedBody'),
    showUpgradeAction: true
  })
}

function exportFormat(
  fmt: 'svg' | 'png' | 'gd' | 'cs' | 'mmd' | 'run_csv' | 'fc_csv' | 'json'
): void {
  const doc = store.doc.value
  if (fmt === 'svg') {
    canvasRef.value?.exportSvgDiagram(safeSlug.value)
    exportOpen.value = false
    showToast({
      title: t('playground.toast.exportedTitle', { file: `${safeSlug.value}.svg` }),
      body: t('playground.toast.exportedBody'),
      showUpgradeAction: true
    })
  } else if (fmt === 'png') {
    canvasRef.value?.exportPngDiagram(safeSlug.value)
    exportOpen.value = false
    showToast({
      title: t('playground.toast.exportedTitle', { file: `${safeSlug.value}.png` }),
      body: t('playground.toast.exportedBody'),
      showUpgradeAction: true
    })
  } else if (fmt === 'gd') {
    downloadFile(`${safeSlug.value}_economy.gd`, exportMxGodotGd(doc))
  } else if (fmt === 'cs') {
    downloadFile(`${safeSlug.value}Economy.cs`, exportMxUnityCs(doc))
  } else if (fmt === 'mmd') {
    downloadFile(`${safeSlug.value}.mmd`, exportMxToMermaid(doc))
  } else if (fmt === 'run_csv') {
    if (!store.activeRun.value) store.playAgain()
    if (store.activeRun.value) {
      downloadFile(
        `${safeSlug.value}_play.csv`,
        exportMxRunCsv(doc, store.activeRun.value),
        'text/csv'
      )
    }
  } else if (fmt === 'fc_csv') {
    if (!store.forecast.value) store.runForecast()
    if (store.forecast.value) {
      downloadFile(
        `${safeSlug.value}_forecast.csv`,
        exportMxForecastCsv(doc, store.forecast.value),
        'text/csv'
      )
    }
  } else if (fmt === 'json') {
    downloadFile(`${safeSlug.value}.mx.json`, JSON.stringify(doc, null, 2), 'application/json')
  }
}

function triggerImportJson(): void {
  exportOpen.value = false
  fileInputRef.value?.click()
}

function onImportFile(e: Event): void {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const parsed = normalizeMxDocument(JSON.parse(String(reader.result ?? '')))
      store.replaceDoc(parsed)
      store.playAgain()
      setTimeout(() => canvasRef.value?.fitToScreen(), 30)
      showToast(
        {
          title: t('playground.toast.importedOk', { title: parsed.title || file.name })
        },
        4500
      )
    } catch {
      showToast({ title: t('playground.toast.importedErr') }, 5000)
    }
    input.value = ''
  }
  reader.readAsText(file)
}

const downstreamItems = computed(() => [
  { key: 'dsNumerical', reason: 'downstream' as const },
  { key: 'dsGdd', reason: 'downstream' as const },
  { key: 'dsUiPsd', reason: 'downstream' as const },
  { key: 'dsPlayableHtml', reason: 'downstream' as const },
  { key: 'dsSpine', reason: 'downstream' as const },
  { key: 'dsNovel', reason: 'downstream' as const }
])
</script>

<template>
  <div
    class="mx-studio pg-shell"
    @click="
      () => {
        exportOpen = false
        downstreamOpen = false
      }
    "
  >
    <!-- ═════════════ ① 顶部主栏（官网返回 + 沙盘核心操控 + 桌面全量版转化触点） ═════════════ -->
    <header class="mx-topbar pg-topbar">
      <div class="mx-topbar-left">
        <a class="pg-back-home" :href="homeHref">
          <img
            :src="'../assets/logo-mark.png'"
            alt=""
            width="20"
            height="20"
            class="pg-brand-logo"
          />
          <span>{{ t('playground.brand.backHome') }}</span>
        </a>
        <span class="pg-live-badge">{{ t('playground.brand.badge') }}</span>
        <input
          type="text"
          class="mx-title-input"
          :value="store.doc.value.title"
          @input="
            store.mutate((d) => {
              d.title = ($event.target as HTMLInputElement).value
            }, 'title')
          "
        />
      </div>

      <div class="mx-topbar-center">
        <div class="mx-mode-pill mx-complexity-pill">
          <button
            type="button"
            class="mx-mode-btn"
            :class="{ 'is-active': store.complexityMode.value === 'simple' }"
            @click="store.switchComplexityMode('simple', true)"
          >
            {{ t('playground.modes.simple') }}
          </button>
          <button
            type="button"
            class="mx-mode-btn"
            :class="{ 'is-active': store.complexityMode.value === 'pro' }"
            @click="store.switchComplexityMode('pro', true)"
          >
            {{ t('playground.modes.pro') }}
          </button>
        </div>

        <button
          type="button"
          class="mx-top-btn"
          :class="{ 'is-active': store.resultsOpen.value && store.resultsTab.value === 'playable' }"
          @click="openPlayableHudTab"
        >
          {{ t('playground.modes.playableBtn') }}
        </button>

        <div class="mx-mode-pill pg-hide-narrow">
          <button
            type="button"
            class="mx-mode-btn"
            :class="{ 'is-active': store.mode.value === 'build' }"
            @click="store.enterBuildMode()"
          >
            {{ t('mx.top.build') }}
          </button>
          <button
            type="button"
            class="mx-mode-btn"
            :class="{ 'is-active': store.mode.value === 'scenarios' }"
            @click="store.enterScenariosMode()"
          >
            {{ t('mx.top.scenarios') }}
          </button>
        </div>
      </div>

      <div class="mx-topbar-right">
        <!-- AI 一句话建图（桌面全量版能力触点） -->
        <button
          type="button"
          class="mx-top-btn pg-ai-wish-btn"
          @click="openFullAppPrompt('ai_agent', t('playground.proTriggers.aiWishBtn'))"
        >
          {{ t('playground.proTriggers.aiWishBtn') }}
        </button>

        <!-- 下游多工作台与 MCP 全链路联动（桌面全量版能力触点） -->
        <div class="mx-export-wrap pg-hide-narrow" @click.stop>
          <button
            type="button"
            class="mx-top-btn"
            @click="
              () => {
                downstreamOpen = !downstreamOpen
                exportOpen = false
              }
            "
          >
            {{ t('playground.proTriggers.downstreamBtn') }}
          </button>
          <div v-if="downstreamOpen" class="mx-export-menu pg-downstream-menu">
            <button
              v-for="item in downstreamItems"
              :key="item.key"
              type="button"
              @click="openFullAppPrompt(item.reason, t(`playground.proTriggers.${item.key}`))"
            >
              <span>{{ t(`playground.proTriggers.${item.key}`) }}</span>
              <span class="pg-pro-chip">Desktop</span>
            </button>
            <hr />
            <button
              type="button"
              @click="openFullAppPrompt('mcp', t('playground.proTriggers.mcpBtn'))"
            >
              <span>{{ t('playground.proTriggers.mcpBtn') }} (102 Tools)</span>
              <span class="pg-pro-chip">npx</span>
            </button>
            <button
              type="button"
              @click="openFullAppPrompt('workspace', t('playground.proTriggers.saveProjectBtn'))"
            >
              <span>{{ t('playground.proTriggers.saveProjectBtn') }}</span>
              <span class="pg-pro-chip">Local</span>
            </button>
          </div>
        </div>

        <!-- 导出与分享菜单（网页端全开放导出 + 链接分享） -->
        <div class="mx-export-wrap" @click.stop>
          <button
            type="button"
            class="mx-top-btn"
            @click="
              () => {
                exportOpen = !exportOpen
                downstreamOpen = false
              }
            "
          >
            ⇣ {{ t('mx.top.export') }} ▾
          </button>
          <div v-if="exportOpen" class="mx-export-menu">
            <button type="button" @click="copyShareUrl">
              <span>{{
                linkCopied ? t('playground.modes.linkCopied') : t('playground.modes.shareLink')
              }}</span>
            </button>
            <hr />
            <button type="button" @click="exportFormat('png')">
              <span>{{ t('mx.top.exportPng') }}</span>
            </button>
            <button type="button" @click="exportFormat('svg')">
              <span>{{ t('mx.top.exportSvg') }}</span>
            </button>
            <hr />
            <button type="button" @click="exportFormat('gd')">Godot 4 (.gd)</button>
            <button type="button" @click="exportFormat('cs')">Unity C# (.cs)</button>
            <button type="button" @click="exportFormat('mmd')">Mermaid (.mmd)</button>
            <button type="button" @click="exportFormat('run_csv')">Play CSV (.csv)</button>
            <button type="button" @click="exportFormat('fc_csv')">Forecast CSV (.csv)</button>
            <button type="button" @click="exportFormat('json')">
              Machinations JSON (.mx.json)
            </button>
            <hr />
            <button type="button" @click="triggerImportJson">⇡ {{ t('mx.top.importJson') }}</button>
          </div>
          <input
            ref="fileInputRef"
            type="file"
            accept=".json"
            style="display: none"
            @change="onImportFile"
          />
        </div>

        <button type="button" class="mx-top-btn pg-icon-btn" @click="toggleLanguage">
          {{ isEn ? '中文' : 'EN' /* cjk-ok */ }}
        </button>

        <button
          type="button"
          class="mx-top-btn pg-icon-btn"
          :title="t('mx.canvas.cycleTheme')"
          @click="toggleSiteTheme"
        >
          {{ themePreference === 'light' ? '☀' : '☾' }}
        </button>

        <button type="button" class="pg-cta-download-btn" @click="openFullAppPrompt('cta')">
          {{ t('playground.proTriggers.downloadCta') }}
        </button>
      </div>
    </header>

    <!-- ═════════════ ①.5 经典玩法一键试玩速切栏 + 120fps 反推快捷入口 ═════════════ -->
    <div class="pg-preset-bar">
      <div class="pg-preset-scroll">
        <span class="pg-preset-label">{{ t('playground.presets.label') }}</span>
        <button
          v-for="p in QUICK_PRESETS"
          :key="p.id"
          type="button"
          class="pg-preset-pill"
          :class="{ 'is-active': activePresetId === p.id }"
          @click="selectQuickPreset(p.id)"
        >
          {{ t(p.labelKey) }}
        </button>
      </div>
      <div class="pg-preset-right">
        <button type="button" class="pg-quick-link-btn" @click="openCurveGoalSeekTab">
          {{ t('playground.modes.curveDragBtn') }}
        </button>
        <button type="button" class="pg-reset-btn" @click="resetCurrentPreset">
          ↺ {{ t('playground.brand.resetDemo') }}
        </button>
      </div>
    </div>

    <!-- 首次访问试玩引导条（可一键收起，内含 AI 建图桌面版引导） -->
    <div v-if="showTipBanner" class="pg-tip-banner">
      <span class="pg-tip-text">{{ t('playground.banner.tip') }}</span>
      <div class="pg-tip-actions">
        <button
          type="button"
          class="pg-tip-upgrade-link"
          @click="openFullAppPrompt('ai_agent', t('playground.proTriggers.aiWishBtn'))"
        >
          {{ t('playground.banner.tryAiLink') }}
        </button>
        <button
          type="button"
          class="pg-tip-close"
          :title="t('playground.banner.dismiss')"
          @click="dismissTipBanner"
        >
          ×
        </button>
      </div>
    </div>

    <!-- ═════════════ 主工作区（左栏 + 抽屉 + 画布/结果 + 右侧检查器） ═════════════ -->
    <div class="mx-main">
      <nav v-show="store.mode.value !== 'workbench'" class="mx-left-rail">
        <button
          type="button"
          class="mx-rail-btn pg-rail-ai-btn"
          @click="openFullAppPrompt('ai_agent', t('playground.proTriggers.aiWishBtn'))"
        >
          <span class="mx-rail-ico">✨</span>
          <span class="mx-rail-lbl">{{ t('mx.nav.agent') }}</span>
        </button>
        <button
          v-for="item in navItems"
          :key="item.id"
          type="button"
          class="mx-rail-btn"
          :class="{ 'is-active': store.drawer.value === item.id }"
          @click="toggleDrawer(item.id)"
        >
          <span class="mx-rail-ico">{{ item.icon }}</span>
          <span class="mx-rail-lbl">{{ t(item.labelKey) }}</span>
        </button>
      </nav>

      <MxDrawer v-show="store.mode.value !== 'workbench'" @fit-view="canvasRef?.fitToScreen()" />

      <div class="mx-center-col">
        <div
          v-if="store.mode.value === 'scenarios' && store.resultsTab.value !== 'workbench'"
          class="mx-scenarios-bar"
        >
          <div class="mx-sc-bar-left">
            <span class="mx-sc-bar-tag">⇄ {{ t('mx.top.scenarios') }}</span>
            <button
              type="button"
              class="mx-sc-pill"
              :class="{ 'is-active': !store.doc.value.activeScenarioId }"
              @click="store.selectScenario(undefined)"
            >
              Baseline
            </button>
            <button
              v-for="sc in store.doc.value.scenarios"
              :key="sc.id"
              type="button"
              class="mx-sc-pill"
              :class="{ 'is-active': store.doc.value.activeScenarioId === sc.id }"
              @click="store.selectScenario(sc.id)"
            >
              {{ sc.name }}
            </button>
            <button type="button" class="mx-sc-pill is-add" @click="store.addScenario()">
              + Scenario
            </button>
          </div>

          <div class="mx-sc-bar-params">
            <label v-for="p in store.doc.value.params" :key="p.id" class="mx-sc-param-chip">
              <span class="mx-sc-param-name">{{ p.name }}</span>
              <input
                type="number"
                step="0.1"
                class="mx-sc-param-input"
                :value="getScenarioParamVal(p.name, p.value)"
                @input="updateScenarioParamVal(p.name, ($event.target as HTMLInputElement).value)"
              />
              <span
                v-if="formatScenarioDelta(p.name, p.value)"
                class="mx-sc-delta"
                :class="formatScenarioDelta(p.name, p.value).startsWith('+') ? 'is-pos' : 'is-neg'"
              >
                {{ formatScenarioDelta(p.name, p.value) }}
              </span>
            </label>
          </div>

          <button type="button" class="mx-sc-compare-btn" @click="store.runAllScenariosCompare()">
            ⇄ {{ t('mx.results.compare') }} ({{ store.doc.value.scenarios.length + 1 }})
          </button>
        </div>

        <MxCanvas v-show="store.mode.value !== 'workbench'" ref="canvasRef" />
        <MxResultsPanel />
      </div>

      <MxInspector v-show="store.mode.value !== 'workbench'" />
    </div>

    <MxFormulaModal />
    <MxFloatingTip />

    <!-- 导出后非阻塞桌面版转化浮窗 -->
    <div v-if="activeToast" class="pg-toast" role="status">
      <div class="pg-toast-top">
        <strong>{{ activeToast.title }}</strong>
        <button type="button" class="pg-toast-close" @click="activeToast = null">×</button>
      </div>
      <p v-if="activeToast.body" class="pg-toast-body">{{ activeToast.body }}</p>
      <button
        v-if="activeToast.showUpgradeAction"
        type="button"
        class="pg-toast-cta"
        @click="openFullAppPrompt('export_nudge')"
      >
        {{ t('playground.toast.exportedAction') }}
      </button>
    </div>

    <!-- 下载安装全量桌面版转化弹窗 -->
    <FullVersionPromptModal
      :open="promptOpen"
      :reason="promptReason"
      :target-feature-label="promptTargetLabel"
      @close="promptOpen = false"
      @export-current-json="exportFormat('json')"
    />
  </div>
</template>

<style scoped>
.mx-studio {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  overflow: hidden;
}

.mx-topbar {
  min-height: 46px;
  padding: 4px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
  z-index: 30;
}

.mx-topbar-left,
.mx-topbar-center,
.mx-topbar-right {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.pg-back-home {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}

.pg-back-home:hover {
  border-color: var(--accent);
  background: var(--bg-hover);
}

.pg-brand-logo {
  border-radius: 4px;
  flex-shrink: 0;
}

.pg-live-badge {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.16), rgba(59, 130, 246, 0.16));
  border: 1px solid rgba(16, 185, 129, 0.42);
  color: var(--success);
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  white-space: nowrap;
}

.mx-title-input {
  width: clamp(110px, 13vw, 200px);
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: 5px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  background: transparent;
}
.mx-title-input:hover {
  background: var(--bg-hover);
  border-color: var(--border);
}
.mx-title-input:focus {
  background: var(--bg-input);
  border-color: var(--accent);
  outline: none;
}

.mx-mode-pill {
  display: inline-flex;
  padding: 2px;
  border-radius: 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  flex-shrink: 0;
}
.mx-mode-btn {
  padding: 4px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.mx-mode-btn.is-active {
  background: var(--bg-panel);
  color: var(--text);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.14);
}

.mx-export-wrap {
  position: relative;
}
.mx-export-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 230px;
  width: max-content;
  padding: 5px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 9px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.34);
  display: flex;
  flex-direction: column;
  z-index: 60;
}
.pg-downstream-menu {
  min-width: 310px;
}
.mx-export-menu button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  white-space: nowrap;
  text-align: left;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}
.mx-export-menu button:hover {
  background: var(--accent-12);
  color: var(--accent);
}
.mx-export-menu hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 4px 0;
}

.pg-pro-chip {
  font-family: var(--mono);
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--accent-12);
  color: var(--accent-fg);
  font-weight: 600;
}

.mx-top-btn {
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.mx-top-btn:hover {
  background: var(--bg-hover);
}
.mx-top-btn.is-active {
  background: var(--accent-12);
  border-color: var(--accent);
  color: var(--accent);
}

.pg-ai-wish-btn {
  border-color: color-mix(in srgb, #8b5cf6 50%, var(--border));
  background: linear-gradient(
    135deg,
    color-mix(in srgb, #8b5cf6 15%, var(--bg-elevated)),
    color-mix(in srgb, #3b82f6 12%, var(--bg-elevated))
  );
  color: var(--text);
}
.pg-ai-wish-btn:hover {
  border-color: #8b5cf6;
}

.pg-icon-btn {
  padding: 0 8px;
  min-width: 32px;
}

.pg-cta-download-btn {
  height: 30px;
  padding: 0 13px;
  border: none;
  border-radius: 7px;
  background: linear-gradient(135deg, #3b82f6, #6366f1);
  color: #ffffff;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: 0 3px 12px rgba(59, 130, 246, 0.32);
  transition: filter 0.15s ease;
}
.pg-cta-download-btn:hover {
  filter: brightness(1.08);
}

/* ═════════════ 经典玩法速切栏 ═════════════ */
.pg-preset-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 12px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  z-index: 24;
}

.pg-preset-scroll {
  display: flex;
  align-items: center;
  gap: 5px;
  overflow-x: auto;
  min-width: 0;
  scrollbar-width: none;
}
.pg-preset-scroll::-webkit-scrollbar {
  display: none;
}

.pg-preset-label {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
  margin-right: 2px;
}

.pg-preset-pill {
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}
.pg-preset-pill:hover {
  color: var(--text);
  border-color: var(--accent);
}
.pg-preset-pill.is-active {
  background: var(--accent-18);
  border-color: var(--accent);
  color: var(--accent-fg);
}

.pg-preset-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.pg-quick-link-btn {
  height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--success) 42%, var(--border));
  background: color-mix(in srgb, var(--success) 10%, var(--bg-elevated));
  color: var(--success);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.pg-reset-btn {
  height: 24px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 11px;
  background: transparent;
  color: var(--text-muted);
  white-space: nowrap;
}

/* ═════════════ 引导提示条 ═════════════ */
.pg-tip-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 12px;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--accent) 11%, var(--bg-elevated)),
    color-mix(in srgb, #8b5cf6 9%, var(--bg-elevated))
  );
  border-bottom: 1px solid color-mix(in srgb, var(--accent) 26%, var(--border));
  font-size: 11.5px;
  flex-shrink: 0;
}

.pg-tip-text {
  color: var(--text);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pg-tip-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.pg-tip-upgrade-link {
  padding: 2px 8px;
  border: none;
  border-radius: 5px;
  background: var(--accent-18);
  color: var(--accent-fg);
  font-size: 11.5px;
  font-weight: 700;
}
.pg-tip-upgrade-link:hover {
  background: var(--accent-25);
}

.pg-tip-close {
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 15px;
  line-height: 1;
}

@media (max-width: 1180px) {
  .pg-hide-narrow {
    display: none;
  }
  .pg-live-badge {
    display: none;
  }
}

/* ═════════════ 主画布骨架（与 MachinationsStudio 一致） ═════════════ */
.mx-main {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.mx-left-rail {
  width: 56px;
  flex-shrink: 0;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  padding: 6px 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  user-select: none;
}
.mx-rail-btn {
  padding: 6px 2px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--text-muted);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  cursor: pointer;
}
.mx-rail-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.mx-rail-btn.is-active {
  background: var(--accent-12);
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}
.pg-rail-ai-btn {
  border-color: color-mix(in srgb, #8b5cf6 38%, transparent);
  background: color-mix(in srgb, #8b5cf6 10%, transparent);
  color: var(--text);
}
.pg-rail-ai-btn:hover {
  border-color: #8b5cf6;
  background: color-mix(in srgb, #8b5cf6 18%, transparent);
}
.mx-rail-ico {
  font-size: 14px;
  line-height: 1.1;
  font-weight: 700;
}
.mx-rail-lbl {
  font-size: 9px;
  text-align: center;
  line-height: 1.1;
}

.mx-center-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.mx-scenarios-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 12px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.mx-sc-bar-left {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.mx-sc-bar-tag {
  font-size: 11px;
  font-weight: 700;
  color: var(--accent);
  padding-right: 4px;
}
.mx-sc-pill {
  height: 24px;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.mx-sc-pill:hover {
  color: var(--text);
  border-color: var(--accent);
}
.mx-sc-pill.is-active {
  background: var(--accent);
  border-color: var(--accent);
  color: #ffffff;
}
.mx-sc-pill.is-add {
  border-style: dashed;
  color: var(--accent);
}
.mx-sc-bar-params {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex: 1;
}
.mx-sc-param-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  font-size: 11px;
}
.mx-sc-param-name {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 600;
  color: var(--text-muted);
}
.mx-sc-param-input {
  width: 58px;
  height: 20px;
  padding: 0 5px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-input);
  color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}
.mx-sc-delta {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 4px;
}
.mx-sc-delta.is-pos {
  background: rgba(16, 185, 129, 0.14);
  color: #10b981;
}
.mx-sc-delta.is-neg {
  background: rgba(239, 68, 68, 0.14);
  color: #ef4444;
}
.mx-sc-compare-btn {
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: var(--accent-12);
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}
.mx-sc-compare-btn:hover {
  background: var(--accent);
  color: #ffffff;
}

/* ═════════════ 导出后转化浮窗 ═════════════ */
.pg-toast {
  position: fixed;
  right: 18px;
  bottom: 52px;
  z-index: 9200;
  width: min(360px, calc(100vw - 36px));
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--accent) 42%, var(--border));
  background: var(--bg-panel);
  color: var(--text);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.42);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pg-toast-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12.5px;
}
.pg-toast-close {
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 15px;
}
.pg-toast-body {
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--text-muted);
}
.pg-toast-cta {
  align-self: flex-start;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--accent);
  background: var(--accent-12);
  color: var(--accent-fg);
  font-size: 11.5px;
  font-weight: 700;
}
</style>
