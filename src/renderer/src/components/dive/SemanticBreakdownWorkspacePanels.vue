<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { renderChatMarkdown } from '@shared/chatMarkdown'
import {
  exportTimelineSubtitlesSrt,
  renderBreakdownReportMd,
  semanticToScriptTimeline,
  type BreakdownLang,
  type SemanticEditInput,
  type SemanticTimeline,
  type ShotEvidence,
  type SoundSourceVerdict,
  type UtteranceEvidence
} from '@shared/semanticTimeline'
import SemanticCompareView from '../SemanticCompareView.vue'
import { useStudioI18n } from '../../composables/useStudioI18n'

const props = defineProps<{
  mode: 'remake' | 'audio' | 'report'
  timeline: SemanticTimeline
  sourceRelativePath?: string
  originalUrl?: string
  resultUrl?: string
  compareVideoUrl?: string
}>()

const emit = defineEmits<{
  seekAndSwitchTimeline: [sec: number]
  edit: [input: SemanticEditInput]
  rerunShot: [shotId: string]
}>()

const { t, locale } = useStudioI18n()

const lang = computed<BreakdownLang>(() =>
  locale.value.toLowerCase().startsWith('en') ? 'en' : 'zh'
)
const isEn = computed(() => lang.value === 'en')

const breakdown = computed(() => props.timeline.breakdown)
const plan = computed(() => breakdown.value?.productionPlan)
const audio = computed(() => breakdown.value?.audioAnalysis)
const cast = computed(() => breakdown.value?.wholeVideo?.cast)

const copiedKey = ref('')
const reportViewMode = ref<'readme' | 'source'>('readme')
let copyTimer: ReturnType<typeof setTimeout> | null = null

async function copyText(key: string, text: string): Promise<void> {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    copiedKey.value = key
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = ''
    }, 1800)
  } catch {
    /* clipboard blocked */
  }
}

const packagingRows = computed(() => {
  const rows: Array<{
    id: string
    shotId: string
    start: number
    end: number
    kind: string
    text: string
    position: string
  }> = []
  for (const s of props.timeline.shots ?? []) {
    if (s.removed) continue
    for (const l of s.layers ?? []) {
      rows.push({
        id: `${s.id}-${l.id}`,
        shotId: s.id,
        start: l.start,
        end: l.end,
        kind: l.kind,
        text: l.text ?? '',
        position: l.position ?? '—'
      })
    }
  }
  if (rows.length === 0) {
    for (const r of props.timeline.textLayers ?? []) {
      rows.push({
        id: r.id,
        shotId: r.shotId ?? '',
        start: r.range.start,
        end: r.range.end,
        kind: r.kind,
        text: r.text,
        position: '—'
      })
    }
  }
  return rows.sort((a, b) => a.start - b.start)
})

const srtContent = computed(() => exportTimelineSubtitlesSrt(props.timeline))

function downloadSrt(): void {
  const content = srtContent.value
  if (!content.trim()) return
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${props.timeline.id || 'subtitles'}.srt`
  a.click()
  URL.revokeObjectURL(url)
}

const reportMd = computed(() => renderBreakdownReportMd(props.timeline, lang.value))
const reportHtml = computed(() =>
  renderChatMarkdown(reportMd.value, {
    copyCode: t('graph.semanticTimeline.rea.copyPrompt')
  })
)

function onReportBodyClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  const btn = target?.closest('[data-copy-code]') as HTMLButtonElement | null
  if (!btn) return
  const codeEl = btn.closest('.md-code')?.querySelector('pre code')
  const codeText = codeEl?.textContent ?? ''
  if (!codeText) return
  void navigator.clipboard?.writeText(codeText).then(() => {
    btn.classList.add('copied')
    setTimeout(() => btn.classList.remove('copied'), 1500)
  })
}

function copyNleTimelineJson(): void {
  const shots: ShotEvidence[] = (props.timeline.shots ?? [])
    .filter((s) => !s.removed)
    .map((s) => ({
      id: s.id,
      range: s.range,
      keyframes: s.keyframes,
      confidence: s.base?.confidence ?? 0.9,
      transitionIn: s.transitionIn,
      forensics: s.forensics
    }))
  const utterances: UtteranceEvidence[] = (props.timeline.dialogue ?? []).map((d) => ({
    id: d.id,
    range: d.range,
    text: d.text,
    speaker: d.speaker,
    words: d.words,
    granularity: d.granularity,
    confidence: d.confidence
  }))
  const nle = semanticToScriptTimeline({
    timeline: props.timeline,
    shots,
    utterances,
    sourceRelativePath: props.sourceRelativePath ?? ''
  })
  void copyText('nle', JSON.stringify(nle, null, 2))
}

const storyboardUrl = ref('')
watch(
  () => [props.timeline.id, breakdown.value?.summary.storyboardRelativePath] as const,
  async ([id, rel]) => {
    storyboardUrl.value = ''
    const pathInProject = rel?.trim() || (id ? `Semantic/${id}/evidence/storyboard.jpg` : '')
    if (!pathInProject) return
    const normalized = pathInProject.startsWith('Semantic/')
      ? pathInProject
      : id
        ? `Semantic/${id}/${pathInProject.replace(/^\/+/, '')}`
        : pathInProject
    try {
      storyboardUrl.value = (await window.studio.getAssetFileUrl(normalized)) ?? ''
    } catch {
      storyboardUrl.value = ''
    }
  },
  { immediate: true }
)

const soundCards = computed(() => {
  const ss = audio.value?.soundSources
  if (!ss) return []
  const items: Array<{ key: string; label: string; verdict: SoundSourceVerdict }> = []
  if (ss.voice) {
    items.push({
      key: 'voice',
      label: t('graph.semanticTimeline.rea.trackVoice'),
      verdict: ss.voice
    })
  }
  if (ss.music) {
    items.push({
      key: 'music',
      label: t('graph.semanticTimeline.rea.trackMusic'),
      verdict: ss.music
    })
  }
  if (ss.sfx) {
    items.push({
      key: 'sfx',
      label: t('graph.semanticTimeline.rea.trackSfx'),
      verdict: ss.sfx
    })
  }
  return items
})

function topProbs(probs: Record<string, number> | undefined): Array<{ k: string; pct: number }> {
  if (!probs) return []
  return Object.entries(probs)
    .filter(([, v]) => Number.isFinite(v) && v > 0.01)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, v]) => ({ k, pct: Math.round(v * 100) }))
}

function onUnitPromptChange(unitId: string, field: 'imagePrompt' | 'videoPrompt', ev: Event): void {
  const value = (ev.target as HTMLTextAreaElement | null)?.value ?? ''
  emit('edit', {
    op: 'unit.prompt',
    target: unitId,
    patch: { [field]: value }
  })
}

function resetUnitPrompt(unitId: string): void {
  emit('edit', {
    op: 'unit.prompt',
    target: unitId,
    patch: { imagePrompt: '', videoPrompt: '' }
  })
}
</script>

<template>
  <div class="rea-panels">
    <!-- 1. Multi-Route Remake Plan -->
    <template v-if="mode === 'remake'">
      <section v-if="plan" class="rea-card">
        <h4>{{ t('graph.semanticTimeline.rea.planSummaryTitle') }}</h4>
        <p class="rea-lead">{{ isEn ? plan.summaryEn : plan.summaryZh }}</p>
      </section>

      <!-- Real User Assets Needed -->
      <section v-if="plan?.userAssetsNeeded.length" class="rea-card warn-border">
        <h4>{{ t('graph.semanticTimeline.rea.realAssetsTitle') }}</h4>
        <ul class="rea-list">
          <li v-for="(item, idx) in plan.userAssetsNeeded" :key="`asset-${idx}`">
            <span class="rea-tag warn">{{ item.shotId }} · {{ item.kind }}</span>
            <span>{{ item.description }}</span>
          </li>
        </ul>
      </section>

      <!-- Cross-shot Cast, Scenes & Props -->
      <section
        v-if="cast && (cast.characters.length || cast.scenes.length || cast.props.length)"
        class="rea-card"
      >
        <h4>{{ t('graph.semanticTimeline.rea.castTitle') }}</h4>
        <div class="rea-grid">
          <div v-for="ch in cast.characters" :key="ch.id" class="rea-subcard">
            <div class="rea-subhead">
              <strong>{{ ch.name }}</strong>
              <span class="rea-tag accent">{{ ch.refTag }}</span>
            </div>
            <p class="rea-desc">{{ ch.look }}</p>
            <span class="rea-meta">{{ ch.shotIds.join(', ') }}</span>
          </div>
          <div v-for="sc in cast.scenes" :key="sc.id" class="rea-subcard">
            <div class="rea-subhead">
              <strong>{{ sc.where }}</strong>
              <span class="rea-tag">{{ sc.id }}</span>
            </div>
            <p class="rea-desc">{{ sc.look }}</p>
            <span class="rea-meta">{{ sc.shotIds.join(', ') }}</span>
          </div>
          <div v-for="pr in cast.props" :key="pr.id" class="rea-subcard">
            <div class="rea-subhead">
              <strong>{{ pr.name }}</strong>
              <span v-if="pr.refTag" class="rea-tag accent">{{ pr.refTag }}</span>
            </div>
            <p v-if="pr.note" class="rea-desc">{{ pr.note }}</p>
            <span class="rea-meta">{{ pr.shotIds.join(', ') }}</span>
          </div>
        </div>
      </section>

      <!-- AI Video Generation Units G1..Gk -->
      <section class="rea-card">
        <h4>{{ t('graph.semanticTimeline.rea.genUnitsTitle') }}</h4>
        <p v-if="!plan?.units.length" class="rea-muted">
          {{ t('graph.semanticTimeline.rea.noUnitsHint') }}
        </p>
        <div v-else class="rea-stack">
          <div v-for="u in plan.units" :key="u.id" class="rea-subcard">
            <div class="rea-subhead">
              <strong>{{ u.id }} · {{ u.sceneHeader }}</strong>
              <span class="rea-tag accent">{{ u.conditioningMode }}</span>
              <span v-for="tag in u.referenceTags" :key="tag" class="rea-tag">{{ tag }}</span>
              <span v-if="u.userEditedPrompt" class="rea-tag warn">
                {{ t('graph.semanticTimeline.rea.editedPromptBadge') }}
              </span>
              <button
                v-if="u.userEditedPrompt"
                type="button"
                class="rea-btn-sm"
                @click="resetUnitPrompt(u.id)"
              >
                {{ t('graph.semanticTimeline.rea.resetOverride') }}
              </button>
              <span class="rea-meta">
                {{
                  t('graph.semanticTimeline.rea.unitShots', {
                    shots: u.shotIds.join(', '),
                    sec: u.durationSec.toFixed(1)
                  })
                }}
              </span>
            </div>

            <div class="rea-prompt-box">
              <div class="rea-prompt-bar">
                <span>{{ t('graph.semanticTimeline.rea.imagePromptLabel') }}</span>
                <button
                  type="button"
                  class="rea-btn-sm"
                  @click="copyText(`${u.id}-img`, u.imagePrompt)"
                >
                  {{
                    copiedKey === `${u.id}-img`
                      ? t('graph.semanticTimeline.rea.copied')
                      : t('graph.semanticTimeline.rea.copyPrompt')
                  }}
                </button>
              </div>
              <textarea
                class="rea-prompt-input"
                rows="2"
                :value="u.imagePrompt"
                @change="onUnitPromptChange(u.id, 'imagePrompt', $event)"
              />
            </div>

            <div class="rea-prompt-box">
              <div class="rea-prompt-bar">
                <span>{{ t('graph.semanticTimeline.rea.videoPromptLabel') }}</span>
                <button
                  type="button"
                  class="rea-btn-sm"
                  @click="copyText(`${u.id}-vid`, u.videoPrompt)"
                >
                  {{
                    copiedKey === `${u.id}-vid`
                      ? t('graph.semanticTimeline.rea.copied')
                      : t('graph.semanticTimeline.rea.copyPrompt')
                  }}
                </button>
              </div>
              <textarea
                class="rea-prompt-input"
                rows="3"
                :value="u.videoPrompt"
                @change="onUnitPromptChange(u.id, 'videoPrompt', $event)"
              />
            </div>
          </div>
        </div>
      </section>

      <!-- Zero-Cost Local FFmpeg Units K1..Kk -->
      <section class="rea-card">
        <h4>{{ t('graph.semanticTimeline.rea.localUnitsTitle') }}</h4>
        <p v-if="!plan?.localUnits.length" class="rea-muted">
          {{ t('graph.semanticTimeline.rea.noUnitsHint') }}
        </p>
        <div v-else class="rea-grid">
          <div v-for="k in plan.localUnits" :key="k.id" class="rea-subcard">
            <div class="rea-subhead">
              <strong>{{ k.id }} · {{ k.shotId }}</strong>
              <span class="rea-tag">{{ k.mode }}</span>
            </div>
            <p class="rea-desc">
              {{
                k.mode === 'ken_burns'
                  ? t('graph.semanticTimeline.rea.kenBurnsSpec', {
                      zoom: (k.zoomPerSec * 100).toFixed(1),
                      pan: (k.panPxPerSec * 100).toFixed(1),
                      deg: Math.round(k.panDirDeg)
                    })
                  : t('graph.semanticTimeline.rea.staticHoldSpec', {
                      sec: k.durationSec.toFixed(1)
                    })
              }}
            </p>
          </div>
        </div>
      </section>

      <!-- Shooting Setups S1..Sk -->
      <section v-if="plan?.shootingSetups.length" class="rea-card">
        <h4>{{ t('graph.semanticTimeline.rea.shootingSetupsTitle') }}</h4>
        <div class="rea-grid">
          <div v-for="s in plan.shootingSetups" :key="s.id" class="rea-subcard">
            <div class="rea-subhead">
              <strong>{{ s.id }} · {{ s.sceneLabel }}</strong>
              <span class="rea-meta">{{ s.shotIds.join(', ') }}</span>
            </div>
            <p class="rea-desc">
              {{ [s.shotSize, s.cameraSupport, s.lightingSetup].filter(Boolean).join(' · ') }}
            </p>
            <p v-if="s.lightingDetail" class="rea-muted">{{ s.lightingDetail }}</p>
            <div v-if="s.gear.length" class="rea-tags">
              <span v-for="g in s.gear" :key="g" class="rea-tag">{{ g }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Code Composition Specs C1..Ck -->
      <section v-if="plan?.codeSpecs.length" class="rea-card">
        <h4>{{ t('graph.semanticTimeline.rea.codeSpecsTitle') }}</h4>
        <div class="rea-grid">
          <div v-for="c in plan.codeSpecs" :key="c.id" class="rea-subcard">
            <div class="rea-subhead">
              <strong>{{ c.id }} · {{ c.codeStyle }}</strong>
              <span class="rea-meta">
                {{ c.shotIds.join(', ') }} · {{ c.durationSec.toFixed(1) }}s
              </span>
            </div>
            <div v-if="c.palette.length" class="rea-swatches">
              <span v-for="hex in c.palette" :key="hex" class="rea-swatch" :title="hex">
                <i :style="{ background: hex }" />
                <code>{{ hex }}</code>
              </span>
            </div>
            <p class="rea-desc">{{ isEn ? c.recipeEn : c.recipeZh }}</p>
          </div>
        </div>
      </section>
    </template>

    <!-- 2. Sound Forensics & Vertical Packaging -->
    <template v-else-if="mode === 'audio'">
      <section class="rea-card">
        <h4>{{ t('graph.semanticTimeline.rea.audioOverviewTitle') }}</h4>
        <p v-if="!audio || !audio.hasAudio" class="rea-muted">
          {{ t('graph.semanticTimeline.rea.noAudioTrack') }}
        </p>
        <div v-else class="rea-stack">
          <div class="rea-tags">
            <span v-if="audio.rmsDbfs != null" class="rea-tag">
              {{
                t('graph.semanticTimeline.rea.loudnessSpec', {
                  rms: audio.rmsDbfs.toFixed(1),
                  peak: (audio.peakDbfs ?? 0).toFixed(1)
                })
              }}
            </span>
            <span v-if="audio.voice.present" class="rea-tag">
              {{
                t('graph.semanticTimeline.rea.voiceMetrics', {
                  speech: Math.round(audio.voice.speechRatio * 100),
                  f0: Math.round(audio.voice.f0MedianHz ?? 0)
                })
              }}
            </span>
            <span v-if="audio.music.present" class="rea-tag">
              {{
                t('graph.semanticTimeline.rea.musicMetrics', {
                  bpm: Math.round(audio.music.bpm ?? 0),
                  key: audio.music.key ?? '—',
                  beat: Math.round((audio.music.beatSyncedCutRatio ?? 0) * 100)
                })
              }}
            </span>
          </div>
          <p
            v-if="audio.perClipAudio"
            class="rea-cut-banner"
            :class="{ warn: audio.perClipAudio.resetsAtCuts }"
          >
            {{
              audio.perClipAudio.resetsAtCuts
                ? t('graph.semanticTimeline.rea.cutJumpReset', {
                    ratio: audio.perClipAudio.ratio.toFixed(2)
                  })
                : t('graph.semanticTimeline.rea.cutJumpContinuous', {
                    ratio: audio.perClipAudio.ratio.toFixed(2)
                  })
            }}
          </p>
        </div>
      </section>

      <section v-if="soundCards.length" class="rea-card">
        <h4>{{ t('graph.semanticTimeline.rea.soundSourcesTitle') }}</h4>
        <div class="rea-grid">
          <div v-for="sc in soundCards" :key="sc.key" class="rea-subcard">
            <div class="rea-subhead">
              <strong>{{ sc.label }}</strong>
              <span class="rea-tag accent">
                {{ isEn ? sc.verdict.sourceEn : sc.verdict.sourceZh }}
              </span>
              <span class="rea-meta">{{ Math.round(sc.verdict.confidence * 100) }}%</span>
            </div>
            <div class="rea-bars">
              <div v-for="p in topProbs(sc.verdict.probs)" :key="p.k" class="rea-bar-row">
                <span class="rea-bar-name">{{ p.k }}</span>
                <div class="rea-bar-track">
                  <div class="rea-bar-fill" :style="{ width: `${p.pct}%` }" />
                </div>
                <span class="rea-bar-pct">{{ p.pct }}%</span>
              </div>
            </div>
            <ul v-if="sc.verdict.evidence.length" class="rea-list compact">
              <li v-for="(ev, idx) in sc.verdict.evidence" :key="idx">{{ ev }}</li>
            </ul>
            <div v-if="sc.verdict.howToConfirm.length" class="rea-confirm">
              <strong>{{ t('graph.semanticTimeline.rea.howToConfirm') }}:</strong>
              <span>{{ sc.verdict.howToConfirm.join(' · ') }}</span>
            </div>
          </div>
        </div>
      </section>

      <section class="rea-card">
        <div class="rea-card-head">
          <h4>
            {{ t('graph.semanticTimeline.rea.packagingTitle', { n: packagingRows.length }) }}
          </h4>
          <div class="rea-actions">
            <button
              type="button"
              class="rea-btn-sm"
              :disabled="!srtContent.trim()"
              @click="copyText('srt', srtContent)"
            >
              {{
                copiedKey === 'srt'
                  ? t('graph.semanticTimeline.rea.copied')
                  : t('graph.semanticTimeline.rea.copySrt')
              }}
            </button>
            <button
              type="button"
              class="rea-btn-sm"
              :disabled="!srtContent.trim()"
              @click="downloadSrt"
            >
              {{ t('graph.semanticTimeline.rea.exportSrt') }}
            </button>
          </div>
        </div>
        <p v-if="!packagingRows.length" class="rea-muted">
          {{ t('graph.semanticTimeline.rea.noPackaging') }}
        </p>
        <div v-else class="rea-table-wrap">
          <table class="rea-table">
            <thead>
              <tr>
                <th>{{ t('graph.semanticTimeline.rea.layerColTime') }}</th>
                <th>{{ t('graph.semanticTimeline.rea.layerColKind') }}</th>
                <th>{{ t('graph.semanticTimeline.rea.layerColPos') }}</th>
                <th>{{ t('graph.semanticTimeline.rea.layerColText') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in packagingRows"
                :key="row.id"
                class="clickable"
                @click="emit('seekAndSwitchTimeline', row.start)"
              >
                <td class="mono">{{ row.start.toFixed(2) }}–{{ row.end.toFixed(2) }}s</td>
                <td>
                  <span class="rea-tag">{{ row.kind }}</span>
                </td>
                <td>{{ row.position }}</td>
                <td>{{ row.text || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <!-- 3. Report & Synchronized Side-by-Side Comparison -->
    <template v-else>
      <section class="rea-card">
        <h4>{{ t('graph.semanticTimeline.rea.compareTitle') }}</h4>
        <SemanticCompareView
          v-if="originalUrl && resultUrl"
          :original-url="originalUrl"
          :result-url="resultUrl"
          :compare-video-url="compareVideoUrl"
          :shot-ids="(timeline.shots ?? []).filter((s) => !s.removed).map((s) => s.id)"
          @rerun-shot="emit('rerunShot', $event)"
        />
        <p v-else class="rea-muted">
          {{ t('graph.semanticTimeline.rea.compareEmptyHint') }}
        </p>
      </section>

      <section v-if="storyboardUrl" class="rea-card">
        <h4>{{ t('graph.semanticTimeline.rea.storyboardTitle') }}</h4>
        <img :src="storyboardUrl" alt="storyboard" class="rea-storyboard-img" />
      </section>

      <section class="rea-card">
        <div class="rea-card-head">
          <h4>{{ t('graph.semanticTimeline.rea.reportTitle') }}</h4>
          <div class="rea-actions">
            <div class="rea-seg">
              <button
                type="button"
                class="rea-seg-btn"
                :class="{ active: reportViewMode === 'readme' }"
                @click="reportViewMode = 'readme'"
              >
                {{ t('graph.semanticTimeline.rea.reportViewReadme') }}
              </button>
              <button
                type="button"
                class="rea-seg-btn"
                :class="{ active: reportViewMode === 'source' }"
                @click="reportViewMode = 'source'"
              >
                {{ t('graph.semanticTimeline.rea.reportViewSource') }}
              </button>
            </div>
            <button type="button" class="rea-btn-sm" @click="copyNleTimelineJson">
              {{
                copiedKey === 'nle'
                  ? t('graph.semanticTimeline.rea.copied')
                  : t('graph.semanticTimeline.rea.copyNleJson')
              }}
            </button>
            <button type="button" class="rea-btn-sm" @click="copyText('report', reportMd)">
              {{
                copiedKey === 'report'
                  ? t('graph.semanticTimeline.rea.copied')
                  : t('graph.semanticTimeline.rea.copyReportMd')
              }}
            </button>
          </div>
        </div>
        <!-- eslint-disable-next-line vue/no-v-html -- sanitized via @shared/chatMarkdown (html stripped & escaped) -->
        <div
          v-if="reportViewMode === 'readme'"
          class="rea-report-readme"
          @click="onReportBodyClick"
          v-html="reportHtml"
        />
        <pre v-else class="rea-report-md">{{ reportMd }}</pre>
      </section>
    </template>
  </div>
</template>

<style scoped>
.rea-panels {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding-bottom: 12px;
}
.rea-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
}
.rea-card.warn-border {
  border-color: color-mix(in srgb, #f4a261 60%, var(--border));
}
.rea-card h4 {
  margin: 0;
  font-size: 13px;
  color: var(--text);
}
.rea-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.rea-lead {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text);
}
.rea-muted {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}
.rea-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.rea-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
}
.rea-subcard {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
}
.rea-subhead {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 12px;
}
.rea-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text);
}
.rea-meta {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.rea-tags,
.rea-actions,
.rea-swatches {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.rea-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text-muted);
  font-size: 11px;
}
.rea-tag.accent {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  color: var(--text);
}
.rea-tag.warn {
  border-color: color-mix(in srgb, #f4a261 65%, var(--border));
  color: #f4a261;
}
.rea-swatch {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  font-size: 11px;
}
.rea-swatch i {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1px solid var(--border);
}
.rea-prompt-box {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
}
.rea-prompt-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-muted);
}
.rea-prompt-input {
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: 6px 8px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
}
.rea-prompt-input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.rea-pre,
.rea-report-md {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.55;
  color: var(--text);
}
.rea-report-md {
  max-height: 560px;
  overflow: auto;
  padding: 12px 14px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
}
.rea-seg {
  display: inline-flex;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  overflow: hidden;
}
.rea-seg-btn {
  padding: 3px 8px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}
.rea-seg-btn + .rea-seg-btn {
  border-left: 1px solid var(--border);
}
.rea-seg-btn.active {
  background: color-mix(in srgb, var(--accent) 16%, var(--bg-elevated));
  color: var(--text);
  font-weight: 600;
}
.rea-report-readme {
  max-height: 620px;
  overflow: auto;
  padding: 16px 20px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 13px;
  line-height: 1.65;
  word-break: break-word;
}
.rea-report-readme :deep(> *:first-child) {
  margin-top: 0;
}
.rea-report-readme :deep(> *:last-child) {
  margin-bottom: 0;
}
.rea-report-readme :deep(h1) {
  margin: 0 0 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
  font-size: 17px;
  font-weight: 700;
  line-height: 1.35;
}
.rea-report-readme :deep(h2) {
  margin: 18px 0 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
  font-size: 14.5px;
  font-weight: 700;
  line-height: 1.4;
}
.rea-report-readme :deep(h3) {
  margin: 14px 0 6px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.45;
}
.rea-report-readme :deep(p) {
  margin: 8px 0;
}
.rea-report-readme :deep(ul),
.rea-report-readme :deep(ol) {
  margin: 6px 0 10px;
  padding-left: 20px;
}
.rea-report-readme :deep(li) {
  margin: 4px 0;
}
.rea-report-readme :deep(strong) {
  font-weight: 600;
  color: var(--text);
}
.rea-report-readme :deep(blockquote) {
  margin: 10px 0;
  padding: 6px 12px;
  border-left: 3px solid var(--accent);
  border-radius: 0 4px 4px 0;
  background: var(--bg-panel);
  color: var(--text-muted);
}
.rea-report-readme :deep(hr) {
  margin: 14px 0;
  border: 0;
  border-top: 1px solid var(--border);
}
.rea-report-readme :deep(.md-code-inline) {
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
}
.rea-report-readme :deep(.inline-ref) {
  display: inline-block;
  padding: 0 5px;
  border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
  background: color-mix(in srgb, var(--accent) 14%, var(--bg-panel));
  color: var(--accent);
  font-size: 11.5px;
  font-weight: 600;
}
.rea-report-readme :deep(.md-code) {
  margin: 10px 0;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  overflow: hidden;
}
.rea-report-readme :deep(.md-code-bar) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-muted);
}
.rea-report-readme :deep(.md-code-copy) {
  display: inline-flex;
  align-items: center;
  padding: 2px 5px;
  border-radius: 4px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.rea-report-readme :deep(.md-code-copy:hover) {
  border-color: var(--border);
  color: var(--text);
}
.rea-report-readme :deep(.md-code-copy .md-icon-done) {
  display: none;
}
.rea-report-readme :deep(.md-code-copy.copied .md-icon-copy) {
  display: none;
}
.rea-report-readme :deep(.md-code-copy.copied .md-icon-done) {
  display: inline;
  color: var(--accent);
}
.rea-report-readme :deep(.md-pre) {
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
}
.rea-report-readme :deep(table) {
  display: block;
  width: 100%;
  overflow-x: auto;
  margin: 10px 0 12px;
  border-collapse: collapse;
  font-size: 12px;
}
.rea-report-readme :deep(th),
.rea-report-readme :deep(td) {
  padding: 6px 10px;
  border: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}
.rea-report-readme :deep(th) {
  background: var(--bg-panel);
  color: var(--text);
  font-weight: 600;
  white-space: nowrap;
}
.rea-report-readme :deep(tbody tr:nth-child(even)) {
  background: color-mix(in srgb, var(--bg-panel) 55%, transparent);
}
.rea-report-readme :deep(.md-link) {
  color: var(--accent);
  text-decoration: underline;
}
.rea-btn-sm {
  padding: 3px 8px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}
.rea-btn-sm:hover:not(:disabled) {
  border-color: var(--accent);
}
.rea-btn-sm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.rea-list {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}
.rea-list.compact {
  font-size: 11px;
  color: var(--text-muted);
}
.rea-cut-banner {
  margin: 0;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  font-size: 12px;
}
.rea-cut-banner.warn {
  border-color: color-mix(in srgb, #f4a261 60%, var(--border));
}
.rea-bars {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rea-bar-row {
  display: grid;
  grid-template-columns: 96px 1fr 38px;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}
.rea-bar-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
}
.rea-bar-track {
  height: 6px;
  border-radius: 999px;
  background: var(--bg-panel);
  overflow: hidden;
}
.rea-bar-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--accent);
}
.rea-bar-pct {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}
.rea-confirm {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.45;
}
.rea-table-wrap {
  overflow: auto;
}
.rea-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.rea-table th,
.rea-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  text-align: left;
}
.rea-table th {
  color: var(--text-muted);
  font-weight: 600;
}
.rea-table tr.clickable {
  cursor: pointer;
}
.rea-table tr.clickable:hover {
  background: var(--bg-elevated);
}
.rea-table td.mono {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.rea-storyboard-img {
  display: block;
  max-width: 100%;
  border-radius: 6px;
  border: 1px solid var(--border);
}
</style>
