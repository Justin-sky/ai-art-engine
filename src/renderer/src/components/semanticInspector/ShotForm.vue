<template>
  <div class="si-form">
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
import type {
  SemanticEditInput,
  SemanticShot,
  ShotCamera,
  ShotSubject,
  ShotVisual
} from '@shared/semanticTimeline'
import { useStudioI18n } from '../../composables/useStudioI18n'
import { inputValue } from './formUtils'

/** 镜头：主体 / 动作、镜头语言、画面、提示词覆盖、删除与恢复 */
const props = defineProps<{
  shot: SemanticShot
  /** 按当前内容会生成的提示词（只读参照；覆盖框为空时就用它） */
  prompt?: string
}>()
const emit = defineEmits<{ edit: [input: SemanticEditInput] }>()
const { t } = useStudioI18n()

const cameraKeys = ['shotSize', 'angle', 'motion', 'lens'] as const satisfies ReadonlyArray<
  keyof ShotCamera
>
const visualKeys = ['description', 'style', 'lighting', 'grade'] as const satisfies ReadonlyArray<
  keyof ShotVisual
>

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
