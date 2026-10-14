<template>
  <div class="si-form">
    <div class="si-meta">
      <span>{{ t('graph.semanticInspector.entityKind') }}: {{ kindLabel }}</span>
      <span>{{ t('graph.semanticEdit.appearances', { n: entity.appearances?.length ?? 0 }) }}</span>
    </div>
    <label class="si-field">
      <span>{{ t('graph.semanticEdit.entityName') }}</span>
      <input
        :value="entity.name"
        @change="
          emit('edit', {
            op: 'entity.update',
            target: entity.id,
            patch: { name: inputValue($event) }
          })
        "
      />
    </label>

    <!-- 换成什么：指令 + @ 引用的身份参考图 -->
    <fieldset class="si-fieldset">
      <legend>{{ t('graph.semanticInspector.replaceTitle') }}</legend>
      <ul
        v-if="currentRefs.length"
        class="si-chips"
        :aria-label="t('graph.semanticInspector.replaceRefs')"
      >
        <li v-for="(ref, i) in currentRefs" :key="refKey(ref)">
          <span class="si-ref">
            <span class="si-ref-index">@{{ i + 1 }}</span>
            <img v-if="thumbs[refKey(ref)]" :src="thumbs[refKey(ref)]" alt="" />
            <span class="si-ref-label">{{ ref.label || `@${i + 1}` }}</span>
          </span>
        </li>
      </ul>
      <div class="si-field" @focusout="commitInstruction">
        <span>{{ t('graph.semanticInspector.replaceInstruction') }}</span>
        <RefMentionTextarea
          v-model="draft"
          :options="mentionOptions"
          :rows="3"
          :placeholder="t('graph.semanticInspector.replaceInstructionPlaceholder')"
        />
      </div>
      <div v-if="extraCandidates.length" class="si-candidates">
        <span class="si-note">{{ t('graph.semanticInspector.replaceCandidates') }}</span>
        <ul class="si-chips">
          <li v-for="c in extraCandidates" :key="c.candidate.key">
            <button
              type="button"
              class="si-ref"
              :title="t('graph.semanticInspector.replaceInsert', { token: c.token })"
              @mousedown.prevent
              @click="insertToken(c.token)"
            >
              <span class="si-ref-index">{{ c.token }}</span>
              <img v-if="thumbs[c.candidate.key]" :src="thumbs[c.candidate.key]" alt="" />
              <span class="si-ref-label">{{ c.candidate.label }}</span>
            </button>
          </li>
        </ul>
      </div>
      <p v-else-if="!currentRefs.length" class="si-note">
        {{ t('graph.semanticInspector.replaceNoCandidates') }}
      </p>
      <p v-if="busy" class="si-note">{{ t('graph.semanticInspector.saving') }}</p>
      <button v-if="replacement" type="button" class="si-link" @click="clearReplacement">
        {{ t('graph.semanticInspector.replaceClear') }}
      </button>
    </fieldset>

    <!-- 换谁：每个出现镜头在首帧关键帧上点选 / 框选目标 -->
    <fieldset v-if="entityShots.length" class="si-fieldset">
      <legend>{{ t('graph.semanticInspector.targetTitle') }}</legend>
      <ul class="si-chips">
        <li v-for="item in entityShots" :key="item.shot.id">
          <button
            type="button"
            class="si-chip"
            :class="{ regenerate: item.shot.id === activeShotId }"
            :aria-pressed="item.shot.id === activeShotId"
            @click="pickedShotId = item.shot.id"
          >
            {{ item.label }}
            <span class="si-chip-status">{{
              item.mask
                ? t('graph.semanticInspector.targetPicked')
                : t('graph.semanticInspector.targetMissing')
            }}</span>
          </button>
        </li>
      </ul>
      <KeyframeTargetPicker
        v-if="activeKeyframe"
        :keyframe-relative-path="activeKeyframe"
        :mask="activeMask"
        @pick="onPick"
        @clear="clearMask"
      />
      <p v-else class="si-note">{{ t('graph.semanticInspector.targetNoKeyframe') }}</p>
      <p class="si-note">{{ t('graph.semanticInspector.targetHint') }}</p>
    </fieldset>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  effectiveReplacement,
  keyframeProjectPath,
  type Entity,
  type EntityReplacement,
  type EntityReplacementRef,
  type SemanticEditInput,
  type SemanticTimeline
} from '@shared/semanticTimeline'
import type { RefMentionOption } from '@shared/graph'
import { useStudioI18n } from '../../composables/useStudioI18n'
import { useProjectStore } from '../../stores/project'
import { entityKindKey } from '../../features/graph/model/semanticTimelineView'
import { shotLabel } from '../../features/graph/model/semanticSelection'
import {
  buildMentionMenu,
  refKey,
  resolveInstructionReferences,
  type ReferenceCandidate
} from '../../features/graph/model/semanticReferenceCandidates'
import type { EntityMaskResult } from '../../features/graph/model/semanticEntityMask'
import { resolveAssetPreviewUrl } from '../../features/media/assetUrlCache'
import RefMentionTextarea from '../RefMentionTextarea.vue'
import KeyframeTargetPicker from './KeyframeTargetPicker.vue'
import { inputValue } from './formUtils'

/**
 * 实体：改名 + 局部替换。
 *
 * 替换拆成两半：「换成什么」= 指令里 `@` 引用的干净参考图；「换谁」= 每个出现镜头上点选的目标。
 * 原片帧只用来点选位置，**不会**被当成身份参考（帧里有多个实体时那样会串号）。
 */
const props = defineProps<{
  entity: Entity
  timeline: SemanticTimeline
  /** 轨道上被点的那次出现（决定先打开哪一镜的点选） */
  appearance?: number
  candidates: ReferenceCandidate[]
}>()
const emit = defineEmits<{ edit: [input: SemanticEditInput] }>()
const { t } = useStudioI18n()
const project = useProjectStore()

const kindLabel = computed(() => {
  const key = entityKindKey(props.entity.kind)
  return key ? t(`graph.semanticTimeline.${key}`) : props.entity.kind
})

const replacement = computed(() => effectiveReplacement(props.entity))
const currentRefs = computed<EntityReplacementRef[]>(() => replacement.value?.references ?? [])
const masks = computed(() => props.entity.replacement?.masks ?? [])

// ─── 指令与 @ 引用 ─────────────────────────────────────────────────────────────

const draft = ref('')
watch(
  () => replacement.value?.instruction ?? '',
  (value) => {
    draft.value = value
  },
  { immediate: true }
)

const menu = computed(() => buildMentionMenu(currentRefs.value, props.candidates, (n) => `@${n}`))
const mentionOptions = computed<RefMentionOption[]>(() =>
  menu.value.map((c, i) => ({ token: `@${i + 1}`, label: c.label, kind: 'visual' }))
)
/** 还没引用的候选（缩略图条，点一下插入 @n） */
const extraCandidates = computed(() =>
  menu.value
    .map((candidate, i) => ({ candidate, token: `@${i + 1}` }))
    .slice(currentRefs.value.length)
)

const busy = ref(false)

function emitReplacement(next: EntityReplacement | null): void {
  emit('edit', { op: 'entity.replace', target: props.entity.id, patch: { replacement: next } })
}

function current(): EntityReplacement {
  return {
    instruction: replacement.value?.instruction ?? '',
    references: currentRefs.value,
    masks: masks.value
  }
}

/** 没落盘的候选（上游刚生成的 data URL 图）：选中时落到 Semantic/<id>/refs/ */
async function persistCandidate(c: ReferenceCandidate): Promise<EntityReplacementRef> {
  if (c.ref) return c.ref
  const relativePath = await window.studio.saveGraphRunMedia({
    dataUrl: c.dataUrl ?? '',
    key: `ref-${props.entity.id}`,
    outputDir: `Semantic/${props.timeline.id}/refs`
  })
  return { relativePath, label: c.label }
}

async function commitInstruction(e?: FocusEvent): Promise<void> {
  // 焦点还在指令区内（例如点了 @ 菜单）不提交
  const next = e?.relatedTarget as Node | null
  if (next && (e?.currentTarget as HTMLElement | null)?.contains(next)) return
  const text = draft.value
  if (text === (replacement.value?.instruction ?? '')) return
  const resolved = resolveInstructionReferences(text, menu.value, currentRefs.value)
  busy.value = true
  try {
    const references = await Promise.all(resolved.picks.map(persistCandidate))
    draft.value = resolved.instruction
    emitReplacement({ ...current(), instruction: resolved.instruction, references })
  } finally {
    busy.value = false
  }
}

function insertToken(token: string): void {
  const base = draft.value.trimEnd()
  draft.value = base ? `${base} ${token}` : token
  void commitInstruction()
}

function clearReplacement(): void {
  draft.value = ''
  emitReplacement(null)
}

// ─── 缩略图 ───────────────────────────────────────────────────────────────────

const thumbs = ref<Record<string, string>>({})

function thumbPathOf(c: ReferenceCandidate): string {
  if (c.thumbRelativePath) return c.thumbRelativePath
  const assetId = c.ref?.assetId
  return assetId ? (project.assets.find((a) => a.id === assetId)?.relativePath ?? '') : ''
}

watch(
  menu,
  async (items) => {
    for (const c of items) {
      if (thumbs.value[c.key]) continue
      if (c.dataUrl) {
        thumbs.value[c.key] = c.dataUrl
        continue
      }
      const path = thumbPathOf(c)
      if (!path) continue
      try {
        thumbs.value[c.key] = await resolveAssetPreviewUrl(path)
      } catch {
        /* 缩略图拿不到不影响引用 */
      }
    }
  },
  { immediate: true }
)

// ─── 换谁：按镜点选目标 ─────────────────────────────────────────────────────────

const entityShots = computed(() => {
  const ids = new Set<string>([
    ...(props.entity.appearances ?? []).map((a) => a.shotId),
    ...masks.value.map((m) => m.shotId)
  ])
  return (props.timeline.shots ?? [])
    .filter(
      (shot) =>
        !shot.removed &&
        (ids.has(shot.id) || shot.subjects?.some((s) => s.entityId === props.entity.id))
    )
    .map((shot) => ({
      shot,
      label: shotLabel(props.timeline, shot.id),
      mask: masks.value.find((m) => m.shotId === shot.id)
    }))
})

const pickedShotId = ref<string | null>(null)
watch(
  () => [props.entity.id, props.appearance],
  () => {
    pickedShotId.value = null
  }
)
const activeShotId = computed(() => {
  if (pickedShotId.value && entityShots.value.some((s) => s.shot.id === pickedShotId.value)) {
    return pickedShotId.value
  }
  const fromAppearance = props.entity.appearances?.[props.appearance ?? 0]?.shotId
  if (fromAppearance && entityShots.value.some((s) => s.shot.id === fromAppearance)) {
    return fromAppearance
  }
  return entityShots.value[0]?.shot.id ?? ''
})
const activeEntry = computed(() => entityShots.value.find((s) => s.shot.id === activeShotId.value))
/** 与重建首帧同源：中帧优先，其次首帧（见 buildPromptPlan 的 firstFrameRelativePath） */
const activeKeyframe = computed(() => {
  const kf = activeEntry.value?.shot.keyframes
  return keyframeProjectPath(props.timeline.id, kf?.middle ?? kf?.first) ?? ''
})
const activeMask = computed(() => activeEntry.value?.mask)

async function onPick(result: EntityMaskResult): Promise<void> {
  const shotId = activeShotId.value
  if (!shotId || !activeKeyframe.value) return
  busy.value = true
  try {
    const maskRelativePath = await window.studio.saveGraphRunMedia({
      dataUrl: result.dataUrl,
      key: `mask-${props.entity.id}-${shotId}`,
      outputDir: `Semantic/${props.timeline.id}/evidence/masks`
    })
    const others = masks.value.filter((m) => m.shotId !== shotId)
    emitReplacement({
      ...current(),
      masks: [
        ...others,
        {
          shotId,
          keyframeRelativePath: activeKeyframe.value,
          maskRelativePath,
          box: result.box,
          method: result.method
        }
      ]
    })
  } finally {
    busy.value = false
  }
}

function clearMask(): void {
  const shotId = activeShotId.value
  emitReplacement({ ...current(), masks: masks.value.filter((m) => m.shotId !== shotId) })
}
</script>
