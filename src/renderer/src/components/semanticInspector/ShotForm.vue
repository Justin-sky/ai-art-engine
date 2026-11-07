<template>
  <div class="si-form">
    <!-- 4-Axis Forensic Classification & Remake Route Card -->
    <div v-if="shot.base || shot.replication" class="si-rea-card">
      <div class="si-rea-head">
        <label class="si-field grow">
          <span>{{ t('graph.semanticTimeline.rea.prodTypeLabel') }}</span>
          <select
            :value="shot.base?.reviewOverrideLabel ?? ''"
            :disabled="shot.removed"
            @change="onOverrideChange($event)"
          >
            <option value="">
              {{
                t('graph.semanticTimeline.rea.autoDetected', {
                  label: prodLabelName(effectiveAutoLabel)
                })
              }}
            </option>
            <option v-for="lbl in BASE_PRODUCTION_LABELS" :key="lbl" :value="lbl">
              {{ prodLabelName(lbl) }}
            </option>
          </select>
        </label>
        <button
          v-if="shot.base?.reviewOverrideLabel && !shot.removed"
          type="button"
          class="si-btn-xs"
          @click="resetOverride"
        >
          {{ t('graph.semanticTimeline.rea.resetOverride') }}
        </button>
      </div>

      <div v-if="shot.base" class="si-rea-badges">
        <span
          class="si-rea-pill"
          :style="{ '--pill-color': PRODUCTION_LABEL_META[shot.base.label]?.color ?? '#457b9d' }"
        >
          <i class="si-rea-dot" />
          {{ prodLabelName(shot.base.label) }} · {{ Math.round(shot.base.confidence * 100) }}%
        </span>
        <span v-if="shot.base.reviewOverrideLabel" class="si-rea-pill accent">
          {{ t('graph.semanticTimeline.rea.overrideBadge') }}
        </span>
        <span v-if="shot.base.disputed" class="si-rea-pill warn">
          {{ t('graph.semanticTimeline.rea.disputedBadge') }}
        </span>
        <span v-else-if="shot.base.uncertain" class="si-rea-pill muted">
          {{ t('graph.semanticTimeline.rea.uncertainBadge') }}
        </span>
      </div>

      <!-- Posterior Probabilities -->
      <div v-if="topProbRows.length" class="si-rea-probs">
        <div v-for="row in topProbRows" :key="row.label" class="si-prob-row">
          <span class="si-prob-name">{{ prodShortName(row.label) }}</span>
          <div class="si-prob-track">
            <div
              class="si-prob-fill"
              :style="{
                width: `${row.pct}%`,
                background: PRODUCTION_LABEL_META[row.label]?.color ?? 'var(--accent)'
              }"
            />
          </div>
          <span class="si-prob-pct">{{ row.pct }}%</span>
        </div>
      </div>

      <!-- AI Edits on Filmed Footage -->
      <div v-if="shot.base?.aiEdits?.length" class="si-rea-badges">
        <span
          v-for="(ed, idx) in shot.base.aiEdits"
          :key="idx"
          class="si-rea-pill warn"
          :title="ed.evidence"
        >
          {{ aiEditName(ed.kind) }} {{ Math.round(ed.confidence * 100) }}%
        </span>
      </div>

      <!-- Real Material Warning -->
      <p v-if="hasProtectedRealMaterial" class="si-rea-alert">
        {{ t('graph.semanticTimeline.rea.realMaterialAlert') }}
      </p>

      <!-- Measured Cinematography Specs -->
      <div v-if="measuredTags.length" class="si-rea-badges">
        <span v-for="(tag, idx) in measuredTags" :key="idx" class="si-rea-pill muted">
          {{ tag }}
        </span>
      </div>

      <!-- Assigned Remake Route -->
      <div v-if="shot.replication" class="si-rea-route">
        <span class="si-rea-route-label">{{
          t('graph.semanticTimeline.rea.remakeRouteLabel')
        }}</span>
        <span class="si-rea-pill accent">
          {{ executorLabel(shot.replication.executor) }}
          <template v-if="shot.replication.unitId"> · {{ shot.replication.unitId }}</template>
          <template v-if="shot.replication.mode"> ({{ shot.replication.mode }})</template>
        </span>
        <button v-if="effectivePromptText" type="button" class="si-btn-xs" @click="copyShotPrompt">
          {{
            copied
              ? t('graph.semanticTimeline.rea.copied')
              : t('graph.semanticTimeline.rea.copyPrompt')
          }}
        </button>
      </div>

      <!-- Signal & VLM Evidence -->
      <details v-if="allEvidence.length" class="si-rea-evidence">
        <summary>
          {{ t('graph.semanticTimeline.rea.evidenceToggle', { n: allEvidence.length }) }}
        </summary>
        <ul>
          <li v-for="(ev, idx) in allEvidence" :key="idx">{{ ev }}</li>
        </ul>
      </details>
    </div>

    <div v-for="(sub, si) in shot.subjects" :key="`${shot.id}-sub-${si}`" class="si-row">
      <label class="si-field">
        <span>{{ t('graph.semanticEdit.subject') }}</span>
        <input
          :value="sub.name"
          :disabled="!!sub.entityId || shot.removed"
          :title="sub.entityId ? t('graph.semanticEdit.subjectBoundHint') : ''"
          @change="updateSubject(si, { name: inputValue($event) })"
        />
      </label>
      <label class="si-field grow">
        <span>{{ t('graph.semanticEdit.action') }}</span>
        <input
          :value="sub.action ?? ''"
          :disabled="shot.removed"
          @change="updateSubject(si, { action: inputValue($event) })"
        />
      </label>
    </div>
    <button v-if="!shot.removed" type="button" class="si-link" @click="addSubject">
      {{ t('graph.semanticEdit.addSubject') }}
    </button>

    <div class="si-grid">
      <label v-for="key in cameraKeys" :key="`cam-${key}`" class="si-field">
        <span>{{ t(`graph.semanticEdit.camera_${key}`) }}</span>
        <input
          :value="shot.camera?.[key] ?? ''"
          :disabled="shot.removed"
          @change="updateGroup('camera', key, inputValue($event))"
        />
      </label>
      <label v-for="key in visualKeys" :key="`vis-${key}`" class="si-field">
        <span>{{ t(`graph.semanticEdit.visual_${key}`) }}</span>
        <input
          :value="shot.visual?.[key] ?? ''"
          :disabled="shot.removed"
          @change="updateGroup('visual', key, inputValue($event))"
        />
      </label>
    </div>

    <p v-if="!shot.promptOverride?.trim() && prompt" class="si-prompt">
      <span class="si-prompt-label">{{ t('graph.semanticEdit.currentPrompt') }}</span>
      {{ prompt }}
    </p>
    <label class="si-field">
      <span>{{ t('graph.semanticEdit.promptOverride') }}</span>
      <textarea
        :value="shot.promptOverride ?? ''"
        rows="3"
        spellcheck="false"
        :disabled="shot.removed"
        :placeholder="t('graph.semanticEdit.promptOverridePlaceholder')"
        @change="
          emit('edit', {
            op: 'shot.prompt',
            target: shot.id,
            patch: { prompt: inputValue($event) }
          })
        "
      />
    </label>

    <div class="si-actions">
      <button v-if="!shot.removed && canSplitShot" type="button" class="si-btn" @click="splitShot">
        {{ splitButtonLabel }}
      </button>
      <button
        v-if="!shot.removed && canMergeNext"
        type="button"
        class="si-btn"
        @click="emit('edit', { op: 'shot.merge', target: shot.id })"
      >
        {{ t('graph.semanticTimeline.rea.mergeNextShot') }}
      </button>
      <button
        type="button"
        class="si-btn"
        :class="{ danger: !shot.removed }"
        @click="
          emit('edit', { op: shot.removed ? 'shot.restore' : 'shot.remove', target: shot.id })
        "
      >
        {{ shot.removed ? t('graph.semanticEdit.restore') : t('graph.semanticEdit.remove') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  AI_EDIT_META,
  BASE_PRODUCTION_LABELS,
  PRODUCTION_LABEL_META,
  type AiEditKind,
  type ProductionBaseLabel,
  type RemakeExecutorKind,
  type SemanticEditInput,
  type SemanticShot,
  type ShotCamera,
  type ShotSubject,
  type ShotVisual
} from '@shared/semanticTimeline'
import { useStudioI18n } from '../../composables/useStudioI18n'
import { inputValue } from './formUtils'

const props = defineProps<{
  shot: SemanticShot
  prompt?: string
  playheadSec?: number
  canMergeNext?: boolean
}>()
const emit = defineEmits<{ edit: [input: SemanticEditInput] }>()
const { t, te, locale } = useStudioI18n()

const isEn = computed(() => locale.value.toLowerCase().startsWith('en'))

const cameraKeys = ['shotSize', 'angle', 'motion', 'lens'] as const satisfies ReadonlyArray<
  keyof ShotCamera
>
const visualKeys = ['description', 'style', 'lighting', 'grade'] as const satisfies ReadonlyArray<
  keyof ShotVisual
>

function prodLabelName(lbl: ProductionBaseLabel): string {
  const meta = PRODUCTION_LABEL_META[lbl]
  if (!meta) return lbl
  return isEn.value ? meta.en : meta.zh
}

function prodShortName(lbl: ProductionBaseLabel): string {
  const meta = PRODUCTION_LABEL_META[lbl]
  if (!meta) return lbl
  return isEn.value ? meta.shortEn : meta.shortZh
}

function aiEditName(kind: AiEditKind): string {
  const meta = AI_EDIT_META[kind]
  if (!meta) return kind
  return isEn.value ? meta.en : meta.zh
}

function executorLabel(exec: RemakeExecutorKind): string {
  const key = `graph.semanticTimeline.rea.exec_${exec}`
  return te(key) ? t(key) : exec
}

const effectiveAutoLabel = computed<ProductionBaseLabel>(() => {
  const probs = props.shot.base?.probs
  if (probs) {
    const best = Object.entries(probs).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]
    if (best && (BASE_PRODUCTION_LABELS as readonly string[]).includes(best[0])) {
      return best[0] as ProductionBaseLabel
    }
  }
  return props.shot.base?.label ?? 'live_action'
})

const topProbRows = computed(() => {
  const probs = props.shot.base?.probs
  if (!probs) return []
  return Object.entries(probs)
    .filter(
      (entry): entry is [ProductionBaseLabel, number] =>
        (BASE_PRODUCTION_LABELS as readonly string[]).includes(entry[0]) &&
        typeof entry[1] === 'number' &&
        entry[1] > 0.02
    )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label, p]) => ({ label, pct: Math.round(p * 100) }))
})

const hasProtectedRealMaterial = computed(() =>
  Boolean(props.shot.material?.items?.some((it) => it.realMaterial === true))
)

const measuredTags = computed(() => {
  const a = props.shot.forensics?.aspects
  if (!a) return []
  const list: string[] = []
  if (a.framing?.shotSize) list.push(a.framing.shotSize.toUpperCase())
  if (a.camera?.support) list.push(a.camera.support)
  if (a.lighting?.setupName) list.push(a.lighting.setupName)
  if (a.grade?.look) list.push(a.grade.look)
  return list
})

const allEvidence = computed(() => {
  const out: string[] = []
  for (const ev of props.shot.base?.evidence ?? []) if (ev.trim()) out.push(ev.trim())
  for (const ev of props.shot.base?.vlmEvidence ?? []) {
    if (ev.trim() && !out.includes(ev.trim())) out.push(ev.trim())
  }
  return out
})

const effectivePromptText = computed(
  () =>
    props.shot.promptOverride?.trim() ||
    props.shot.replication?.videoPrompt?.trim() ||
    props.prompt?.trim() ||
    ''
)

const copied = ref(false)
async function copyShotPrompt(): Promise<void> {
  const text = effectivePromptText.value
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch {
    /* ignore */
  }
}

function onOverrideChange(e: Event): void {
  const val = (e.target as HTMLSelectElement).value.trim()
  emit('edit', {
    op: 'shot.update',
    target: props.shot.id,
    patch: { reviewOverrideLabel: val || null }
  })
}

function resetOverride(): void {
  emit('edit', {
    op: 'shot.update',
    target: props.shot.id,
    patch: { reviewOverrideLabel: null }
  })
}

const canSplitShot = computed(() => props.shot.range.end - props.shot.range.start >= 0.45)

const resolvedSplitSec = computed(() => {
  const start = props.shot.range.start
  const end = props.shot.range.end
  const ph = props.playheadSec
  if (typeof ph === 'number' && Number.isFinite(ph) && ph > start + 0.21 && ph < end - 0.21) {
    return ph
  }
  return (start + end) / 2
})

const isPlayheadInsideShot = computed(() => {
  const ph = props.playheadSec
  return (
    typeof ph === 'number' &&
    Number.isFinite(ph) &&
    ph > props.shot.range.start + 0.21 &&
    ph < props.shot.range.end - 0.21
  )
})

const splitButtonLabel = computed(() =>
  isPlayheadInsideShot.value
    ? t('graph.semanticTimeline.rea.splitAtPlayhead', { sec: resolvedSplitSec.value.toFixed(2) })
    : t('graph.semanticTimeline.rea.splitMidpoint')
)

function splitShot(): void {
  emit('edit', {
    op: 'shot.split',
    target: props.shot.id,
    patch: { splitAtSec: Number(resolvedSplitSec.value.toFixed(3)) }
  })
}

function updateGroup(group: 'camera' | 'visual', key: string, value: string): void {
  const current = { ...(props.shot[group] ?? {}) } as Record<string, unknown>
  const trimmed = value.trim()
  if (trimmed) current[key] = trimmed
  else delete current[key]
  emit('edit', { op: 'shot.update', target: props.shot.id, patch: { [group]: current } })
}

function updateSubject(index: number, patch: Partial<ShotSubject>): void {
  const subjects = (props.shot.subjects ?? []).map((s, i) => {
    if (i !== index) return s
    const next = { ...s, ...patch }
    if (typeof patch.action === 'string' && !patch.action.trim()) delete next.action
    return next
  })
  emit('edit', { op: 'shot.update', target: props.shot.id, patch: { subjects } })
}

function addSubject(): void {
  emit('edit', {
    op: 'shot.update',
    target: props.shot.id,
    patch: {
      subjects: [...(props.shot.subjects ?? []), { name: t('graph.semanticEdit.newSubject') }]
    }
  })
}
</script>
