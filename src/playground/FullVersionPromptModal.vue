<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

export type FullAppPromptReason =
  'ai_agent' | 'downstream' | 'mcp' | 'workspace' | 'export_nudge' | 'cta'

const props = defineProps<{
  open: boolean
  reason: FullAppPromptReason
  targetFeatureLabel?: string
}>()

const emit = defineEmits<{
  close: []
  exportCurrentJson: []
}>()

const { t } = useI18n()

const GITHUB_RELEASES_URL = 'https://github.com/Justin-sky/ai-art-engine/releases/latest'
const GITEE_RELEASES_URL =
  'https://gitee.com/beijing_blue_whale_era_zhangjian/ai-art-engine/releases'
const MCP_SNIPPET = 'npx -y ai-art-engine-mcp'

const copiedMcp = ref(false)

const detectedOs = computed<'win' | 'mac' | 'linux'>(() => {
  if (typeof navigator === 'undefined') return 'win'
  const ua = `${navigator.userAgent} ${navigator.platform}`.toLowerCase()
  if (ua.includes('mac')) return 'mac'
  if (ua.includes('linux') && !ua.includes('android')) return 'linux'
  return 'win'
})

const primaryDownloadLabel = computed(() => {
  if (detectedOs.value === 'mac') return t('playground.modal.primaryMac')
  if (detectedOs.value === 'linux') return t('playground.modal.primaryLinux')
  return t('playground.modal.primaryWin')
})

const reasonBadge = computed(() => t(`playground.modal.reasons.${props.reason}.badge`))
const reasonTitle = computed(() => t(`playground.modal.reasons.${props.reason}.title`))
const reasonDesc = computed(() => t(`playground.modal.reasons.${props.reason}.desc`))

async function copyMcpCmd(): Promise<void> {
  try {
    await navigator.clipboard.writeText(MCP_SNIPPET)
    copiedMcp.value = true
    setTimeout(() => {
      copiedMcp.value = false
    }, 1800)
  } catch {
    // ignore clipboard errors
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.open) {
    emit('close')
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="pg-modal-backdrop"
      role="dialog"
      aria-modal="true"
      @click.self="emit('close')"
    >
      <div class="pg-modal-card">
        <div class="pg-modal-glow" aria-hidden="true" />
        <header class="pg-modal-head">
          <div class="pg-modal-head-meta">
            <span class="pg-modal-eyebrow">{{ t('playground.modal.eyebrow') }}</span>
            <span class="pg-modal-free-pill">{{ t('playground.modal.freeTag') }}</span>
          </div>
          <button
            type="button"
            class="pg-modal-close"
            :aria-label="t('playground.modal.closeAria')"
            @click="emit('close')"
          >
            ×
          </button>
        </header>

        <div class="pg-modal-body">
          <div class="pg-modal-reason-box">
            <div class="pg-modal-reason-tags">
              <span class="pg-reason-badge">{{ reasonBadge }}</span>
              <span v-if="targetFeatureLabel" class="pg-reason-target">
                {{ targetFeatureLabel }}
              </span>
            </div>
            <h2 class="pg-modal-title">{{ reasonTitle }}</h2>
            <p class="pg-modal-desc">{{ reasonDesc }}</p>
          </div>

          <div v-if="reason === 'mcp'" class="pg-mcp-box">
            <span class="pg-mcp-label">{{ t('playground.modal.mcpSnippetLabel') }}</span>
            <div class="pg-mcp-code-row">
              <code>{{ MCP_SNIPPET }}</code>
              <button type="button" class="pg-mini-copy" @click="copyMcpCmd">
                {{ copiedMcp ? '✓' : 'Copy' }}
              </button>
            </div>
          </div>

          <div class="pg-highlights-sec">
            <h3 class="pg-sec-label">{{ t('playground.modal.highlightsTitle') }}</h3>
            <div class="pg-highlights-grid">
              <div class="pg-hi-item">
                <span class="pg-hi-ico">🤖</span>
                <div>
                  <strong>{{ t('playground.modal.highlights.h1Title') }}</strong>
                  <p>{{ t('playground.modal.highlights.h1Desc') }}</p>
                </div>
              </div>
              <div class="pg-hi-item">
                <span class="pg-hi-ico">🎨</span>
                <div>
                  <strong>{{ t('playground.modal.highlights.h2Title') }}</strong>
                  <p>{{ t('playground.modal.highlights.h2Desc') }}</p>
                </div>
              </div>
              <div class="pg-hi-item">
                <span class="pg-hi-ico">🦴</span>
                <div>
                  <strong>{{ t('playground.modal.highlights.h3Title') }}</strong>
                  <p>{{ t('playground.modal.highlights.h3Desc') }}</p>
                </div>
              </div>
              <div class="pg-hi-item">
                <span class="pg-hi-ico">🔌</span>
                <div>
                  <strong>{{ t('playground.modal.highlights.h4Title') }}</strong>
                  <p>{{ t('playground.modal.highlights.h4Desc') }}</p>
                </div>
              </div>
            </div>
          </div>

          <div class="pg-carry-bar">
            <div class="pg-carry-info">
              <strong>{{ t('playground.modal.carryWorkTitle') }}</strong>
              <span>{{ t('playground.modal.carryWorkDesc') }}</span>
            </div>
            <button type="button" class="pg-carry-btn" @click="emit('exportCurrentJson')">
              {{ t('playground.modal.exportCurrentBtn') }}
            </button>
          </div>
        </div>

        <footer class="pg-modal-foot">
          <div class="pg-dl-primary-row">
            <a
              class="pg-dl-primary-btn"
              :href="GITHUB_RELEASES_URL"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ primaryDownloadLabel }}
            </a>
            <a
              class="pg-dl-secondary-btn"
              :href="GITEE_RELEASES_URL"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ t('playground.modal.giteeMirror') }}
            </a>
          </div>
          <div class="pg-dl-sub-row">
            <a
              class="pg-dl-text-link"
              :href="GITHUB_RELEASES_URL"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ t('playground.modal.allPlatforms') }} ↗
            </a>
            <button type="button" class="pg-keep-playing-btn" @click="emit('close')">
              {{ t('playground.modal.continueSandbox') }}
            </button>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.pg-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9800;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  background: rgba(6, 9, 16, 0.72);
  backdrop-filter: blur(8px);
}

.pg-modal-card {
  position: relative;
  width: min(690px, 100%);
  max-height: min(90vh, 760px);
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  border: 1px solid color-mix(in srgb, var(--accent) 42%, var(--border));
  background: var(--bg-panel);
  color: var(--text);
  box-shadow:
    0 0 0 1px rgba(99, 102, 241, 0.16),
    0 28px 80px rgba(0, 0, 0, 0.55);
  overflow: hidden;
}

.pg-modal-glow {
  position: absolute;
  inset: 0 0 auto;
  height: 3px;
  background: linear-gradient(90deg, #3b82f6, #8b5cf6, #10b981);
}

.pg-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px 12px;
  border-bottom: 1px solid var(--border);
}

.pg-modal-head-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.pg-modal-eyebrow {
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--accent);
}

.pg-modal-free-pill {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--success) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--success) 38%, transparent);
  color: var(--success);
  font-weight: 600;
}

.pg-modal-close {
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 8px;
  font-size: 18px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.pg-modal-body {
  padding: 16px 18px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.pg-modal-reason-box {
  padding: 13px 15px;
  border-radius: 12px;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--accent) 11%, var(--bg-elevated)),
    var(--bg-elevated)
  );
  border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border));
}

.pg-modal-reason-tags {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 7px;
}

.pg-reason-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 700;
  background: var(--accent-18);
  color: var(--accent-fg);
}

.pg-reason-target {
  display: inline-flex;
  align-items: center;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  background: var(--wash-08);
  color: var(--text);
}

.pg-modal-title {
  font-size: 17px;
  line-height: 1.38;
  font-weight: 700;
  margin-bottom: 6px;
}

.pg-modal-desc {
  font-size: 12.5px;
  line-height: 1.62;
  color: var(--text-muted);
  user-select: text;
}

.pg-mcp-box {
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pg-mcp-label {
  font-size: 11.5px;
  color: var(--text-muted);
}

.pg-mcp-code-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.pg-mcp-code-row code {
  font-family: var(--mono);
  font-size: 13px;
  color: var(--accent-fg);
  user-select: text;
}

.pg-mini-copy {
  padding: 3px 10px;
  font-size: 11.5px;
}

.pg-sec-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.pg-highlights-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

@media (max-width: 600px) {
  .pg-highlights-grid {
    grid-template-columns: 1fr;
  }
}

.pg-hi-item {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 10px 11px;
  border-radius: 10px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
}

.pg-hi-ico {
  font-size: 17px;
  line-height: 1.2;
  flex-shrink: 0;
}

.pg-hi-item strong {
  display: block;
  font-size: 12.5px;
  font-weight: 600;
  margin-bottom: 2px;
}

.pg-hi-item p {
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--text-muted);
}

.pg-carry-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--wash-04);
  border: 1px dashed var(--border);
}

.pg-carry-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 220px;
  flex: 1;
}

.pg-carry-info strong {
  font-size: 12px;
}

.pg-carry-info span {
  font-size: 11.5px;
  color: var(--text-muted);
}

.pg-carry-btn {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.pg-modal-foot {
  padding: 13px 18px 15px;
  border-top: 1px solid var(--border);
  background: var(--bg-elevated);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pg-dl-primary-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.pg-dl-primary-btn {
  flex: 1 1 240px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  padding: 0 18px;
  border-radius: 10px;
  background: linear-gradient(135deg, #3b82f6, #6366f1);
  color: #ffffff;
  font-size: 13.5px;
  font-weight: 700;
  text-decoration: none;
  box-shadow: 0 6px 20px rgba(59, 130, 246, 0.35);
  transition: filter 0.15s ease;
}

.pg-dl-primary-btn:hover {
  filter: brightness(1.08);
}

.pg-dl-secondary-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12.5px;
  font-weight: 600;
  text-decoration: none;
}

.pg-dl-secondary-btn:hover {
  border-color: var(--accent);
}

.pg-dl-sub-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.pg-dl-text-link {
  font-size: 12px;
  color: var(--accent-fg);
  text-decoration: none;
}

.pg-dl-text-link:hover {
  text-decoration: underline;
}

.pg-keep-playing-btn {
  padding: 4px 10px;
  font-size: 12px;
  background: transparent;
  color: var(--text-muted);
}
</style>
