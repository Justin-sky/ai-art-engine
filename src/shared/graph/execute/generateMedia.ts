import {
  appendStyleImagesReferencePrompt,
  buildGeneratedMediaFileKey,
  formatGeneratedMediaStamp
} from '../../domain'
import type { GraphImageReferenceMeta } from '../../modelProvider'
import { expandInstructionMentions } from '../instructionMentions'
import { resolveCharacterReferenceUrls } from '../characterConsistency'
import { episodeFailReasonForStep, parseEpisodeAgentState } from '../episodeAgentState'
import { resolveImageSystemPrompt, resolveVideoSystemPrompt } from '../systemPromptSchemes'
import { buildLipSyncPrompt, resolveLipSyncSystemPrompt } from '../lipSync'
import {
  buildReshootPrompt,
  formatReshootTimestamp,
  isValidReshootSegment,
  resolveReshootSystemPrompt
} from '../reshoot'
import { buildImagePrompt, buildVideoPrompt, buildVoicePrompt } from '../userPromptSchemes'
import {
  resolveImageGenerateParamsForApi,
  imageGenerateParamsToNodePatch,
  resolveMaxInputReferences,
  resolveGenerateSeed
} from '../imageGenerateParams'
import {
  VIDEO_FIRST_FRAME_PORT_ID,
  VIDEO_LAST_FRAME_PORT_ID,
  resolveVideoGenerateParamsForApi,
  videoGenerateParamsToNodePatch,
  type VideoGenerateParamCapabilities
} from '../videoGenerateParams'
import { UNKNOWN_VIDEO_PORT_LIMITS } from '../portInputLimits'
import type { GraphImageItem, GraphValue, NodeExecuteContext } from './types'
import {
  dualImageGalleryOutputs,
  dualVideoGalleryOutputs,
  flattenAssetValues,
  flattenVoicesValues,
  newestVideoSelectedId
} from './gallery'
import { autoIncomingTextForInstruction, selectIncomingValuesForInstruction } from './incoming'
import {
  buildDialogueInputs,
  normalizeDialogueVoiceMap,
  parseDialogueScript
} from '../dialogueScript'
import {
  commitGeneratedImages,
  materializeGeneratedBatch,
  mergeGeneratedImages,
  persistVideoGeneration,
  persistVoiceGeneration
} from './materialize'
import { resolveMentionSources } from './context'
import {
  collectIncomingImageItems,
  collectImageGenerateSourceItems,
  resolveNodeStyleImages,
  resolveStyleReferenceUrls
} from './mediaInputs'
import { fail } from '@shared/errors/appError'
import { SHARED_ERRORS } from '../../errors/catalog'

export async function executeVoiceGenerateNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const instructionRaw = node.params.generateInstruction?.trim() || ''
  const mentionSources = resolveMentionSources(ctx)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const localNotes = expandInstructionMentions(instructionRaw, mentionSources) || undefined
  const incomingText = autoIncomingTextForInstruction(instructionRaw, selected, mentionSources)
  const sourceImages = await collectIncomingImageItems(ctx)

  if (!ctx.generateSpeech) {
    const voices = flattenVoicesValues(selected)
    if (voices.length) {
      const item = voices[0]!
      const notes = [localNotes, incomingText].filter(Boolean).join('\n') || undefined
      if (notes) ctx.patchNode?.({ params: { notes } })
      return {
        out: {
          kind: 'voices',
          items: [
            {
              ...(item.id ? { id: item.id } : {}),
              ...(item.createdAt ? { createdAt: item.createdAt } : {}),
              ...(item.relativePath ? { relativePath: item.relativePath } : {})
            }
          ]
        }
      }
    }
    const text = [localNotes, incomingText].filter(Boolean).join('\n').trim()
    if (!text && !sourceImages.length) throw new Error('GRAPH_PROCESS_NO_INPUT')
    return { out: { kind: 'text', text: text || '(image prompt)' } }
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  let userPrompt = buildVoicePrompt(instruction, ctx.locale)
  if (incomingText) {
    userPrompt = userPrompt.trim() ? `${userPrompt.trim()}\n\n${incomingText}` : incomingText
  }
  /**
   * 这里**刻意不拼系统提示词**。
   *
   * 声音节点的 `input` 是「要被合成的内容」，不是给对话模型的指令：下游三种实现
   * 都是原样当内容读（ComfyUI `prompt: input.input`、方舟 openspeech 的 `text_prompt`、
   * MiniMax 音色设计的 `prompt`），OpenAI 兼容的 `POST /audio/speech` 更是明确规定
   * `input` 就是要朗读的文本。
   *
   * 而声音节点的默认系统提示词是「你是一名专业声音导演。请产出清晰自然的配音或声音设计
   * 说明…」——把它拼在最前面，TTS 模型会**把这句指令也念出来**，产出的音频开头就是一段
   * 与内容无关的话。
   *
   * 若将来要给「声音设计」类模型（靠提示词描述音色）加设计指令，应当走独立的
   * 入口/字段，而不是复用 TTS 的内容字段。
   */
  const prompt = userPrompt

  let images: string[] = []
  if (sourceImages.length) {
    if (ctx.resolveImageUrls) {
      images = (await ctx.resolveImageUrls(sourceImages)).filter(Boolean)
    } else {
      images = sourceImages
        .map((item) => item.dataUrl?.trim())
        .filter((url): url is string => Boolean(url))
    }
  }

  if (!prompt.trim() && !images.length) throw new Error('GRAPH_PROCESS_NO_INPUT')

  const speechVoice =
    typeof node.params.generateSpeechVoice === 'string'
      ? node.params.generateSpeechVoice.trim()
      : undefined
  const speechCharacter =
    typeof node.params.generateSpeechCharacter === 'string'
      ? node.params.generateSpeechCharacter.trim()
      : undefined
  const speechReferenceAudio =
    typeof node.params.generateSpeechReferenceAudio === 'string'
      ? node.params.generateSpeechReferenceAudio.trim()
      : undefined

  const result = await ctx.generateSpeech({
    input: prompt,
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined,
    voice: speechVoice || undefined,
    voiceProfile: speechCharacter || undefined,
    referenceAudio: speechReferenceAudio || undefined,
    name: buildGeneratedMediaFileKey({
      hostAssetName: ctx.resolveHostAssetName?.(),
      nodeTitle: node.title || node.typeId || 'voice',
      stamp: formatGeneratedMediaStamp()
    }),
    images: images.length ? images : undefined,
    outputDir: node.params.mediaOutputDir?.trim() || undefined
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  if (!result.assetId || !result.relativePath) {
    throw fail(SHARED_ERRORS.ttsNoAsset)
  }

  const notes = [localNotes, incomingText].filter(Boolean).join('\n') || undefined
  if (notes) {
    ctx.node.params = { ...ctx.node.params, notes }
    ctx.patchNode?.({ params: { notes } })
  }

  return persistVoiceGeneration(ctx, {
    id: result.assetId,
    createdAt: new Date().toISOString(),
    relativePath: result.relativePath
  })
}

/**
 * 多说话人对话生成（ElevenLabs Text to Dialogue）。
 *
 * 与声音节点的区别只在「谁说什么」：对话稿按行解析（`A: 台词`），
 * 每段绑一个音色（节点参数 `generateDialogueVoices`），整段一次合成。
 * 产物与声音节点同形（单个声音资产），所以复用 persistVoiceGeneration。
 */
export async function executeDialogueGenerateNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const instructionRaw = node.params.generateInstruction?.trim() || ''
  const mentionSources = resolveMentionSources(ctx)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const localNotes = expandInstructionMentions(instructionRaw, mentionSources) || undefined
  const incomingText = autoIncomingTextForInstruction(instructionRaw, selected, mentionSources)

  if (!ctx.generateSpeech) {
    // 没有语音合成能力时退回文本输出，别把图跑挂
    const text = [localNotes, incomingText].filter(Boolean).join('\n').trim()
    return { out: { kind: 'text', text: text || '(dialogue)' } }
  }
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const script = [localNotes, incomingText].filter(Boolean).join('\n').trim()
  if (!script) throw new Error('GRAPH_PROCESS_NO_INPUT')

  const lines = parseDialogueScript(script)
  if (!lines.length) throw fail(SHARED_ERRORS.dialogueEmpty)

  const nodeVoice =
    typeof node.params.generateSpeechVoice === 'string'
      ? node.params.generateSpeechVoice.trim()
      : ''
  const voiceBySpeaker = normalizeDialogueVoiceMap(node.params.generateDialogueVoices)
  const { inputs, missingVoiceAt } = buildDialogueInputs(lines, voiceBySpeaker, nodeVoice)

  if (missingVoiceAt.length) {
    // 明确点名是第几段缺音色：对话稿长起来时只报「缺音色」没法定位
    const speakers = [
      ...new Set(missingVoiceAt.map((index) => lines[index]?.speaker).filter(Boolean))
    ] as string[]
    throw fail(SHARED_ERRORS.dialogueVoiceMissing, {
      lines: missingVoiceAt.map((index) => index + 1).join('、'),
      speakers: speakers.join('、')
    })
  }

  const result = await ctx.generateSpeech({
    // input 只作为日志/兜底内容，真正发出去的是 dialogue
    input: script,
    dialogue: inputs,
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined,
    voice: nodeVoice || undefined,
    name: buildGeneratedMediaFileKey({
      hostAssetName: ctx.resolveHostAssetName?.(),
      nodeTitle: node.title || node.typeId || 'dialogue',
      stamp: formatGeneratedMediaStamp()
    }),
    outputDir: node.params.mediaOutputDir?.trim() || undefined
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  if (!result.assetId || !result.relativePath) {
    throw fail(SHARED_ERRORS.ttsNoAsset)
  }

  const notes = [localNotes, incomingText].filter(Boolean).join('\n') || undefined
  if (notes) {
    ctx.node.params = { ...ctx.node.params, notes }
    ctx.patchNode?.({ params: { notes } })
  }

  return persistVoiceGeneration(ctx, {
    id: result.assetId,
    createdAt: new Date().toISOString(),
    relativePath: result.relativePath
  })
}

/**
 * 音效生成节点（ElevenLabs `textToSoundEffects`）。
 *
 * 与声音节点的区别：描述的是**声音本身**（「雨落在铁皮屋顶上」），
 * 显式走音效端点而不是让 TTS 去念这句话。
 *
 * 没有音效能力时**明确报错**，不回退到声音节点 —— 回退会把描述念出来，
 * 产出「听起来成功、其实完全不对」的语音（踩过这个坑）。
 */
export async function executeSoundEffectNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  if (!ctx.generateSoundEffect) throw fail(SHARED_ERRORS.soundEffectUnsupported)

  const instructionRaw = node.params.generateInstruction?.trim() || ''
  const mentionSources = resolveMentionSources(ctx)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const localNotes = expandInstructionMentions(instructionRaw, mentionSources) || undefined
  const incomingText = autoIncomingTextForInstruction(instructionRaw, selected, mentionSources)

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  // 音效的描述就是要发给上游的文本；**不拼系统提示词**（同上：那是给对话模型的指令）
  const prompt = [localNotes, incomingText].filter(Boolean).join('\n').trim()
  if (!prompt) throw new Error('GRAPH_PROCESS_NO_INPUT')

  const durationSec =
    typeof node.params.generateSoundDurationSec === 'number' &&
    Number.isFinite(node.params.generateSoundDurationSec)
      ? node.params.generateSoundDurationSec
      : undefined
  const promptInfluence =
    typeof node.params.generateSoundPromptInfluence === 'number' &&
    Number.isFinite(node.params.generateSoundPromptInfluence)
      ? node.params.generateSoundPromptInfluence
      : undefined

  const result = await ctx.generateSoundEffect({
    prompt,
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined,
    loop: node.params.generateSoundLoop === true,
    durationSeconds: durationSec,
    promptInfluence,
    name: buildGeneratedMediaFileKey({
      hostAssetName: ctx.resolveHostAssetName?.(),
      nodeTitle: node.title || node.typeId || 'sfx',
      stamp: formatGeneratedMediaStamp()
    }),
    outputDir: node.params.mediaOutputDir?.trim() || undefined
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  if (!result.assetId || !result.relativePath) {
    throw fail(SHARED_ERRORS.ttsNoAsset)
  }

  const notes = [localNotes, incomingText].filter(Boolean).join('\n') || undefined
  if (notes) {
    ctx.node.params = { ...ctx.node.params, notes }
    ctx.patchNode?.({ params: { notes } })
  }

  return persistVoiceGeneration(ctx, {
    id: result.assetId,
    createdAt: new Date().toISOString(),
    relativePath: result.relativePath
  })
}

/**
 * 音乐生成节点（BGM / 配乐）。
 *
 * 与声音 / 音效节点同形（产出声音资产），但走**音乐端点**：
 * 只吃编曲描述（+ 可选歌词），不吃音色、也不吃音效参数。
 *
 * 没有音乐能力时**明确报错**，不回退到其它生成能力 ——
 * 与音效节点同一原则：换成别的能力会产出「听起来成功、其实不对」的产物。
 */
export async function executeMusicGenerateNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  if (!ctx.generateMusic) throw fail(SHARED_ERRORS.musicUnsupported)

  const instructionRaw = node.params.generateInstruction?.trim() || ''
  const mentionSources = resolveMentionSources(ctx)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const localNotes = expandInstructionMentions(instructionRaw, mentionSources) || undefined
  const incomingText = autoIncomingTextForInstruction(instructionRaw, selected, mentionSources)

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  // 编曲描述就是要发给上游的文本；**不拼系统提示词**（那是给对话模型的指令，
  // 拼进去会被当成歌词/描述的一部分影响生成）
  const prompt = [localNotes, incomingText].filter(Boolean).join('\n').trim()
  if (!prompt) throw fail(SHARED_ERRORS.musicNoPrompt)

  const lyrics =
    typeof node.params.generateMusicLyrics === 'string'
      ? node.params.generateMusicLyrics.trim()
      : ''

  const result = await ctx.generateMusic({
    prompt,
    ...(lyrics ? { lyrics } : {}),
    instrumental: node.params.generateMusicInstrumental !== false,
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined,
    name: buildGeneratedMediaFileKey({
      hostAssetName: ctx.resolveHostAssetName?.(),
      nodeTitle: node.title || node.typeId || 'music',
      stamp: formatGeneratedMediaStamp()
    }),
    outputDir: node.params.mediaOutputDir?.trim() || undefined
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  if (!result.assetId || !result.relativePath) {
    throw fail(SHARED_ERRORS.ttsNoAsset)
  }

  const notes = [localNotes, incomingText].filter(Boolean).join('\n') || undefined
  if (notes) {
    ctx.node.params = { ...ctx.node.params, notes }
    ctx.patchNode?.({ params: { notes } })
  }

  return persistVoiceGeneration(ctx, {
    id: result.assetId,
    createdAt: new Date().toISOString(),
    relativePath: result.relativePath
  })
}

/** 视频生成：无 API 时透传上游；有 API 时调用视频模型并输出资产 */
export async function executeVideoGenerateNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const instructionRaw = node.params.generateInstruction?.trim() || ''
  const mentionSources = resolveMentionSources(ctx)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const localNotes = expandInstructionMentions(instructionRaw, mentionSources) || undefined
  const incomingText = autoIncomingTextForInstruction(instructionRaw, selected, mentionSources)

  if (!ctx.generateVideo) {
    return executeVideoGeneratePassthrough(ctx, {
      instructionRaw,
      selected,
      localNotes,
      incomingText
    })
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  let userPrompt = buildVideoPrompt(instruction, ctx.locale)
  if (incomingText) {
    userPrompt = userPrompt.trim() ? `${userPrompt.trim()}\n\n${incomingText}` : incomingText
  }
  const system = resolveVideoSystemPrompt(node.params.generateSystemPrompt, ctx.locale)
  const styleImages = resolveNodeStyleImages(ctx)
  // 风格图占 inputReferences 前 N 张，prompt 用「参考xx风格@n，参考强度…」指代（勿再 expand）
  userPrompt = appendStyleImagesReferencePrompt(userPrompt, styleImages, {
    locale: ctx.locale
  })
  const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt

  const portReferences = await collectMediaInputReferences(ctx, selected)
  const styleUrls = await resolveStyleReferenceUrls(ctx, styleImages)
  // 风格图优先占图片槽位，再拼端口参考（与图片口上限共享额度；@n 与此顺序一致）
  const inputReferences = [
    ...styleUrls.map((url) => ({ kind: 'image_url' as const, url })),
    ...portReferences
  ]
  const firstFrameImageUrl = await resolveVideoFramePortImageUrl(ctx, VIDEO_FIRST_FRAME_PORT_ID)
  const lastFrameImageUrl = await resolveVideoFramePortImageUrl(ctx, VIDEO_LAST_FRAME_PORT_ID)

  if (
    !inputReferences.length &&
    !firstFrameImageUrl &&
    !lastFrameImageUrl &&
    !instruction.trim() &&
    !userPrompt.trim()
  ) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  let capsParams: VideoGenerateParamCapabilities | null = null
  let portLimits = UNKNOWN_VIDEO_PORT_LIMITS
  if (ctx.resolveVideoGenerateCapabilities) {
    try {
      const bundle = await ctx.resolveVideoGenerateCapabilities({
        model: node.params.generateModel || undefined,
        providerInstanceId: node.params.generateProviderInstanceId || undefined
      })
      if (bundle) {
        capsParams = bundle.params
        portLimits = bundle.portLimits
      }
    } catch {
      /* 能力查询失败时沿用节点已保存参数 */
    }
  }

  const genParams = resolveVideoGenerateParamsForApi(node.params, capsParams)
  const paramsPatch = videoGenerateParamsToNodePatch(genParams)
  node.params = { ...node.params, ...paramsPatch }
  ctx.patchNode?.({ params: paramsPatch })

  const limitedRefs = limitVideoInputReferences(inputReferences, portLimits)
  const useFirstFrame =
    genParams.frameMode === 'first' || genParams.frameMode === 'first_last'
      ? firstFrameImageUrl
      : undefined
  const useLastFrame = genParams.frameMode === 'first_last' ? lastFrameImageUrl : undefined
  // 首帧 / 首尾帧模式下参考图与帧口互斥，去掉 image_url 类参考（方舟等：尾帧不可与 reference_image 混用）
  const apiRefs = useFirstFrame?.trim()
    ? limitedRefs.filter((ref) => ref.kind !== 'image_url')
    : limitedRefs

  const result = await ctx.generateVideo({
    prompt,
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined,
    duration: genParams.duration,
    resolution: genParams.resolution,
    aspectRatio: genParams.aspectRatio,
    generateAudio: genParams.generateAudio,
    seed: resolveGenerateSeed(node.params, ctx.resolveProjectGenerateSeed?.()),
    firstFrameImageUrl: useFirstFrame,
    lastFrameImageUrl: useLastFrame,
    inputReferences: apiRefs.length ? apiRefs : undefined,
    outputDir: node.params.mediaOutputDir?.trim() || undefined,
    name: buildGeneratedMediaFileKey({
      hostAssetName: ctx.resolveHostAssetName?.(),
      nodeTitle: node.title || node.typeId || 'video',
      stamp: formatGeneratedMediaStamp()
    }),
    graphBinding: {
      nodeId: node.id,
      assetId: ctx.resolveHostAssetId?.()
    }
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const notes = [localNotes, incomingText].filter(Boolean).join('\n') || undefined

  return persistVideoGeneration(
    ctx,
    {
      id: result.assetId,
      relativePath: result.relativePath,
      createdAt: new Date().toISOString()
    },
    notes
  )
}

/**
 * 对口型：角色图或参考视频 + 声音 → 多模态视频（Seedance 2 等）。
 * 有视频时优先「视频1 + 音频1」；否则「图片1 + 音频1」。不做首尾帧拼装。
 */
export async function executeLipSyncNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx

  const audioInputValues = [...(ctx.inputs['in-voice'] ?? []), ...(ctx.inputs.in ?? [])]
  const audioRefs = await collectMediaInputReferences(ctx, audioInputValues)
  const audioUrl = audioRefs.find((ref) => ref.kind === 'audio_url')?.url?.trim()
  if (!audioUrl) {
    throw new Error('GRAPH_LIPSYNC_NO_AUDIO')
  }

  const videoValues = ctx.inputs['in-video'] ?? []
  const videoRefs = await collectMediaInputReferences(ctx, videoValues)
  const videoUrl = videoRefs.find((ref) => ref.kind === 'video_url')?.url?.trim()

  let imageUrl: string | undefined
  if (!videoUrl) {
    const imageItems = await collectIncomingImageItems(ctx)
    if (ctx.resolveImageUrls && imageItems.length) {
      imageUrl = (await ctx.resolveImageUrls(imageItems.slice(0, 1))).find((u) => u.trim())?.trim()
    } else if (imageItems[0]?.dataUrl?.trim()) {
      imageUrl = imageItems[0].dataUrl.trim()
    }
    if (!imageUrl && ctx.resolveAssetImageUrl) {
      for (const value of [...(ctx.inputs['in-image'] ?? []), ...(ctx.inputs.in ?? [])]) {
        if (value.kind !== 'asset' || value.assetType !== 'image') continue
        const url = await ctx.resolveAssetImageUrl(value.assetId)
        if (url?.trim()) {
          imageUrl = url.trim()
          break
        }
      }
    }
  }

  if (!videoUrl && !imageUrl) {
    throw new Error('GRAPH_LIPSYNC_NO_VISUAL')
  }

  const visualKind = videoUrl ? 'video' : 'image'
  const instructionRaw = node.params.generateInstruction?.trim() || ''
  const mentionSources = resolveMentionSources(ctx)
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const incomingText = autoIncomingTextForInstruction(instructionRaw, selected, mentionSources)
  let userPrompt = buildLipSyncPrompt(instruction, ctx.locale, visualKind)
  if (incomingText) {
    userPrompt = userPrompt.trim() ? `${userPrompt.trim()}\n\n${incomingText}` : incomingText
  }
  const system = resolveLipSyncSystemPrompt(node.params.generateSystemPrompt, ctx.locale)
  const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt

  if (!ctx.generateVideo) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  let capsParams: VideoGenerateParamCapabilities | null = null
  if (ctx.resolveVideoGenerateCapabilities) {
    try {
      const bundle = await ctx.resolveVideoGenerateCapabilities({
        model: node.params.generateModel || undefined,
        providerInstanceId: node.params.generateProviderInstanceId || undefined
      })
      if (bundle) capsParams = bundle.params
    } catch {
      /* 沿用节点已保存参数 */
    }
  }

  const genParams = resolveVideoGenerateParamsForApi(node.params, capsParams)
  // 对口型：强制参考音驱动；不做首尾帧
  const paramsPatch = videoGenerateParamsToNodePatch({
    ...genParams,
    frameMode: 'none',
    generateAudio: genParams.generateAudio ?? true
  })
  node.params = { ...node.params, ...paramsPatch }
  ctx.patchNode?.({ params: paramsPatch })

  const inputReferences: Array<{ kind: 'image_url' | 'video_url' | 'audio_url'; url: string }> =
    videoUrl
      ? [
          { kind: 'video_url', url: videoUrl },
          { kind: 'audio_url', url: audioUrl }
        ]
      : [
          { kind: 'image_url', url: imageUrl! },
          { kind: 'audio_url', url: audioUrl }
        ]

  const result = await ctx.generateVideo({
    prompt,
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined,
    duration: genParams.duration,
    resolution: genParams.resolution,
    aspectRatio: genParams.aspectRatio,
    generateAudio: paramsPatch.generateAudio !== false,
    seed: resolveGenerateSeed(node.params, ctx.resolveProjectGenerateSeed?.()),
    inputReferences,
    outputDir: node.params.mediaOutputDir?.trim() || undefined,
    name: buildGeneratedMediaFileKey({
      hostAssetName: ctx.resolveHostAssetName?.(),
      nodeTitle: node.title || node.typeId || 'lipSync',
      stamp: formatGeneratedMediaStamp()
    }),
    graphBinding: {
      nodeId: node.id,
      assetId: ctx.resolveHostAssetId?.()
    }
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const notes = [instruction, incomingText].filter(Boolean).join('\n') || undefined

  return persistVideoGeneration(
    ctx,
    {
      id: result.assetId,
      relativePath: result.relativePath,
      createdAt: new Date().toISOString()
    },
    notes
  )
}

/**
 * 片段重拍：源视频（必填）+ 参考素材 + 时间戳区间 → Seedance 2.5 时间戳级视频编辑。
 * Prompt 内组装「编辑 @视频1：00:05—00:09 修改要求」，仅重绘指定区间，其余片段保持原视频。
 */
export async function executeVideoReshootNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx

  const videoValues = [...(ctx.inputs['in-video'] ?? []), ...(ctx.inputs.in ?? [])]
  const videoRefs = await collectMediaInputReferences(ctx, videoValues)
  const videoUrl = videoRefs.find((ref) => ref.kind === 'video_url')?.url?.trim()
  if (!videoUrl) {
    throw new Error('GRAPH_RESHOOT_NO_VIDEO')
  }

  const segment = {
    startSec: Number(node.params.reshootStartSec),
    endSec: Number(node.params.reshootEndSec)
  }

  const instructionRaw = node.params.generateInstruction?.trim() || ''
  const mentionSources = resolveMentionSources(ctx)
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const incomingText = autoIncomingTextForInstruction(instructionRaw, selected, mentionSources)
  let userPrompt = buildReshootPrompt(instruction, segment, ctx.locale)
  if (incomingText) {
    userPrompt = userPrompt.trim() ? `${userPrompt.trim()}\n\n${incomingText}` : incomingText
  }
  const system = resolveReshootSystemPrompt(node.params.generateSystemPrompt, ctx.locale)
  const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt

  if (!ctx.generateVideo) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  let capsParams: VideoGenerateParamCapabilities | null = null
  if (ctx.resolveVideoGenerateCapabilities) {
    try {
      const bundle = await ctx.resolveVideoGenerateCapabilities({
        model: node.params.generateModel || undefined,
        providerInstanceId: node.params.generateProviderInstanceId || undefined
      })
      if (bundle) capsParams = bundle.params
    } catch {
      /* 沿用节点已保存参数 */
    }
  }

  const genParams = resolveVideoGenerateParamsForApi(node.params, capsParams)
  const paramsPatch = videoGenerateParamsToNodePatch({
    ...genParams,
    generateAudio: genParams.generateAudio ?? true
  })
  node.params = { ...node.params, ...paramsPatch }
  ctx.patchNode?.({ params: paramsPatch })

  // 源视频必须是第一个视频参考（@视频1）；随后拼图片 / 音频参考
  const referenceValues = [...(ctx.inputs['in-image'] ?? []), ...(ctx.inputs['in-voice'] ?? [])]
  const otherRefs = await collectMediaInputReferences(ctx, referenceValues)
  const inputReferences: Array<{
    kind: 'image_url' | 'video_url' | 'audio_url'
    url: string
  }> = [{ kind: 'video_url', url: videoUrl }, ...otherRefs]

  const result = await ctx.generateVideo({
    prompt,
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined,
    duration: genParams.duration,
    resolution: genParams.resolution,
    aspectRatio: genParams.aspectRatio,
    generateAudio: paramsPatch.generateAudio !== false,
    seed: resolveGenerateSeed(node.params, ctx.resolveProjectGenerateSeed?.()),
    inputReferences,
    outputDir: node.params.mediaOutputDir?.trim() || undefined,
    name: buildGeneratedMediaFileKey({
      hostAssetName: ctx.resolveHostAssetName?.(),
      nodeTitle: node.title || node.typeId || 'reshoot',
      stamp: formatGeneratedMediaStamp()
    }),
    graphBinding: {
      nodeId: node.id,
      assetId: ctx.resolveHostAssetId?.()
    }
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const segmentText = isValidReshootSegment(segment)
    ? `${formatReshootTimestamp(segment.startSec)}—${formatReshootTimestamp(segment.endSec)}`
    : ''
  const notes = [segmentText, instruction, incomingText].filter(Boolean).join('\n') || undefined

  return persistVideoGeneration(
    ctx,
    {
      id: result.assetId,
      relativePath: result.relativePath,
      createdAt: new Date().toISOString()
    },
    notes
  )
}

function executeVideoGeneratePassthrough(
  ctx: NodeExecuteContext,
  args: {
    instructionRaw: string
    selected: GraphValue[]
    localNotes: string | undefined
    incomingText: string
  }
): Record<string, GraphValue> {
  const { selected, localNotes, incomingText } = args
  const videos = flattenAssetValues(selected).filter((item) => item.assetType === 'video')
  const voices = flattenAssetValues(selected).filter((item) => item.assetType === 'voice')
  const gallery = (ctx.node.params.generatedVideos ?? [])
    .filter((item) => item.relativePath?.trim() || item.dataUrl?.trim())
    .map((item) => ({
      id: item.id,
      dataUrl: item.dataUrl || '',
      createdAt: item.createdAt,
      ...(item.relativePath?.trim() ? { relativePath: item.relativePath.trim() } : {})
    }))
  if (!videos.length) {
    if (gallery.length) {
      const selectedVideoId =
        ctx.node.params.selectedVideoId?.trim() || newestVideoSelectedId(gallery)
      return dualVideoGalleryOutputs(gallery, selectedVideoId)
    }
    const text = [localNotes, incomingText].filter(Boolean).join('\n').trim()
    const voiceNotes = voices
      .map((item) => item.title?.trim() || item.label?.trim() || item.notes?.trim() || '')
      .filter(Boolean)
      .join('\n')
    const outText = text || voiceNotes
    if (!outText) throw new Error('GRAPH_PROCESS_NO_INPUT')
    ctx.patchNode?.({ params: { notes: outText } })
    return { out: { kind: 'text', text: outText } }
  }

  const notes = [localNotes, videos[0]!.notes, incomingText].filter(Boolean).join('\n') || undefined
  const merged = [
    ...gallery,
    ...videos.map((item) => ({
      id: item.assetId,
      dataUrl: '',
      ...(item.relativePath?.trim() ? { relativePath: item.relativePath.trim() } : {})
    }))
  ]
  const generatedVideos = merged.map((item, index) => ({
    id: item.id?.trim() || `passthrough:${index}`,
    dataUrl: item.dataUrl || '',
    ...(item.relativePath ? { relativePath: item.relativePath } : {})
  }))
  const selectedVideoId = newestVideoSelectedId(generatedVideos)
  ctx.patchNode?.({
    params: {
      notes,
      previewRelativePath: videos[0]?.relativePath?.trim() || undefined,
      generatedVideos,
      selectedVideoId
    }
  })
  ctx.node.params = {
    ...ctx.node.params,
    generatedVideos,
    selectedVideoId,
    ...(notes !== undefined ? { notes } : {})
  }
  return dualVideoGalleryOutputs(generatedVideos, selectedVideoId)
}

type VideoRefKind = 'image_url' | 'video_url' | 'audio_url'

async function resolveVideoFramePortImageUrl(
  ctx: NodeExecuteContext,
  portId: string
): Promise<string | undefined> {
  const values = ctx.inputs[portId] ?? []
  if (!values.length) return undefined
  const refs = await collectMediaInputReferences(ctx, values)
  return refs.find((ref) => ref.kind === 'image_url')?.url
}

/**
 * 端口值 → 带类型的 URL 引用（image_url / video_url / audio_url）。
 *
 * 视频与音频给的是**工程相对路径**（生成前由主进程门面上传对象存储换成公网 URL），
 * 图片优先走 `resolveImageUrls`。视频生成 / 对口型 / 镜头重拍等视频节点共用，
 * 空间世界生成节点也用它取「参考视频」（见 generateSpatialWorld.ts）。
 */
export async function collectMediaInputReferences(
  ctx: NodeExecuteContext,
  selected: GraphValue[]
): Promise<Array<{ kind: VideoRefKind; url: string }>> {
  const refs: Array<{ kind: VideoRefKind; url: string }> = []
  const seen = new Set<string>()

  const push = (kind: VideoRefKind, url: string): void => {
    const trimmed = url.trim()
    if (!trimmed) return
    const key = `${kind}:${trimmed.slice(0, 64)}:${trimmed.length}`
    if (seen.has(key)) return
    seen.add(key)
    refs.push({ kind, url: trimmed })
  }

  for (const value of selected) {
    if (value.kind === 'images') {
      for (const item of value.items) {
        if (ctx.resolveImageUrls) {
          const urls = await ctx.resolveImageUrls([item])
          for (const url of urls) push('image_url', url)
        } else if (item.dataUrl?.trim()) {
          push('image_url', item.dataUrl)
        }
      }
      continue
    }
    if (value.kind === 'image') {
      if (ctx.resolveImageUrls) {
        const urls = await ctx.resolveImageUrls([value])
        for (const url of urls) push('image_url', url)
      } else if (value.dataUrl?.trim()) {
        push('image_url', value.dataUrl)
      }
      continue
    }
    if (value.kind === 'video' || value.kind === 'videos') {
      const items =
        value.kind === 'videos'
          ? value.items
          : [
              {
                dataUrl: value.dataUrl,
                relativePath: value.relativePath
              }
            ]
      for (const item of items) {
        // 与 resolveAssetMediaDataUrl(video) 一致：优先工程相对路径，生成前再上传 TOS
        const relativePath = item.relativePath?.trim()
        if (relativePath) {
          push('video_url', relativePath.replace(/\\/g, '/'))
          continue
        }
        if (item.dataUrl?.trim()) push('video_url', item.dataUrl)
      }
      continue
    }
    if (value.kind === 'voices') {
      for (const item of value.items) {
        const relativePath = item.relativePath?.trim()
        if (relativePath) {
          push('audio_url', relativePath.replace(/\\/g, '/'))
          continue
        }
        const assetId = item.id?.trim()
        if (assetId && ctx.resolveAssetMediaUrl) {
          const url = await ctx.resolveAssetMediaUrl(assetId)
          if (url) push('audio_url', url)
        }
      }
      continue
    }
    if (value.kind === 'output' && value.voices?.length) {
      for (const item of value.voices) {
        const relativePath = item.relativePath?.trim()
        if (relativePath) {
          push('audio_url', relativePath.replace(/\\/g, '/'))
          continue
        }
        const assetId = item.id?.trim()
        if (assetId && ctx.resolveAssetMediaUrl) {
          const url = await ctx.resolveAssetMediaUrl(assetId)
          if (url) push('audio_url', url)
        }
      }
      continue
    }
    if (value.kind !== 'asset') continue
    const kind: VideoRefKind | null =
      value.assetType === 'image'
        ? 'image_url'
        : value.assetType === 'video'
          ? 'video_url'
          : value.assetType === 'voice'
            ? 'audio_url'
            : null
    if (!kind) continue
    let url: string | undefined
    if (ctx.resolveAssetMediaUrl) {
      url = await ctx.resolveAssetMediaUrl(value.assetId)
    } else if (kind === 'image_url' && ctx.resolveAssetImageUrl) {
      url = await ctx.resolveAssetImageUrl(value.assetId)
    }
    if (url) push(kind, url)
  }

  return refs
}

function limitVideoInputReferences(
  refs: Array<{ kind: VideoRefKind; url: string }>,
  limits: {
    maxImages: number | null
    maxVideos: number | null
    maxVoices: number | null
  }
): Array<{ kind: VideoRefKind; url: string }> {
  const take = (
    kind: VideoRefKind,
    max: number | null
  ): Array<{ kind: VideoRefKind; url: string }> => {
    const list = refs.filter((r) => r.kind === kind)
    if (max == null) return list
    return list.slice(0, Math.max(0, max))
  }
  return [
    ...take('image_url', limits.maxImages),
    ...take('video_url', limits.maxVideos),
    ...take('audio_url', limits.maxVoices)
  ]
}

function patchImageGeneratePreview(ctx: NodeExecuteContext, items: GraphImageItem[]): void {
  const preview = items[0]
  if (!preview) return
  ctx.patchNode?.({
    params: {
      previewDataUrl: preview.dataUrl?.trim() ? preview.dataUrl : undefined,
      previewRelativePath: preview.relativePath?.trim() ? preview.relativePath : undefined
    }
  })
}

/**
 * 图片生成：展开指令后调用图片生成 API，输出 images。
 * 未注入 generateImage 时退回上游图片透传。
 * 可接文本口（提示词）与图片口（参考图）；无 @ 时自动拼入上游正文。
 */
export async function executeImageGenerateNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
  const mentionSources = resolveMentionSources(ctx)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const sourceItems = await collectImageGenerateSourceItems(ctx, instructionRaw)
  const incomingText = autoIncomingTextForInstruction(instructionRaw, selected, mentionSources)

  if (!ctx.generateImage) {
    if (!sourceItems.length) {
      // 无 API 且无参考图：有指令或上游文本则仍算可运行（纯文案节点预览）
      if (!instructionRaw.trim() && !incomingText.trim()) {
        throw new Error('GRAPH_PROCESS_NO_INPUT')
      }
      return dualImageGalleryOutputs([], '')
    }
    patchImageGeneratePreview(ctx, sourceItems)
    return commitGeneratedImages(
      ctx,
      sourceItems.map((item, index) => ({
        ...item,
        id: item.id?.trim() || `source:${index}`
      })),
      sourceItems[0]?.relativePath?.trim()
    )
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  let userPrompt = buildImagePrompt(instruction, ctx.locale)
  if (incomingText) {
    userPrompt = userPrompt.trim() ? `${userPrompt.trim()}\n\n${incomingText}` : incomingText
  }
  const system = resolveImageSystemPrompt(node.params.generateSystemPrompt, ctx.locale)
  const styleImages = resolveNodeStyleImages(ctx)
  // /images 无独立 system 字段，拼入 prompt
  // 风格图占 image[] 前 N 张：追加「参考xx风格@n，参考强度…」，与 API 多图指代一致
  userPrompt = appendStyleImagesReferencePrompt(userPrompt, styleImages, {
    locale: ctx.locale,
    subject: node.params.styleReferenceSubject
  })
  // 剧集流水线产物节点（如 9宫格拼图 / 4宫格拼图）：重跑时附加导演上次 FAIL 原因
  if (node.params.episodeStep && ctx.readEpisodeAgentState) {
    try {
      const scopeKey = node.params.episodeScopeKey?.trim() || 'default'
      const raw = await ctx.readEpisodeAgentState(scopeKey)
      const failReason = episodeFailReasonForStep(
        parseEpisodeAgentState(raw),
        node.params.episodeStep
      )
      if (failReason) {
        userPrompt = `${userPrompt.trim()}\n\n【导演上次 FAIL 原因，必须针对性地修改】${failReason}`
      }
    } catch {
      /* 状态读取失败时不影响生成 */
    }
  }
  const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt

  let portUrls: string[] = []
  if (sourceItems.length) {
    if (ctx.resolveImageUrls) {
      portUrls = (await ctx.resolveImageUrls(sourceItems)).filter(Boolean)
    } else {
      portUrls = sourceItems
        .map((item) => item.dataUrl?.trim())
        .filter((url): url is string => Boolean(url))
    }
  }
  const styleUrls = await resolveStyleReferenceUrls(ctx, styleImages)

  // 无参考图时允许纯文生图；既无参考也无有效指令/上游文本则失败
  if (!portUrls.length && !styleUrls.length && !instruction.trim() && !userPrompt.trim()) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const genParams = resolveImageGenerateParamsForApi(node.params)
  // 把实际使用的默认值写回节点，便于 UI / 下次执行一致
  const paramsPatch = imageGenerateParamsToNodePatch(genParams)
  node.params = { ...node.params, ...paramsPatch }
  ctx.patchNode?.({ params: paramsPatch })

  let maxInputReferences = resolveMaxInputReferences()
  if (ctx.resolveImageGenerateCapabilities) {
    try {
      const caps = await ctx.resolveImageGenerateCapabilities({
        model: node.params.generateModel || undefined,
        providerInstanceId: node.params.generateProviderInstanceId || undefined
      })
      maxInputReferences = resolveMaxInputReferences(caps)
    } catch {
      /* 能力查询失败时沿用默认上限 */
    }
  }
  // 风格图优先占位（@1..@N），与端口参考图共享上限并一并提交
  const cap = Math.max(0, Math.floor(maxInputReferences))
  const styleRefs = styleUrls
    .map((url) => url.trim())
    .filter(Boolean)
    .slice(0, cap)
  const rest = Math.max(0, cap - styleRefs.length)
  const portRefs = portUrls
    .map((url) => url.trim())
    .filter(Boolean)
    .slice(0, rest)
  // 角色一致性：绑定角色引用（自带 imageUrl）注入 inputReferences，排在风格/端口之后
  const characterRefs = node.params.characterRefs ?? []
  const restAfterPort = Math.max(0, cap - styleRefs.length - portRefs.length)
  const charRefUrls = resolveCharacterReferenceUrls(characterRefs, [], restAfterPort)
  // imageUrl 可能是工程相对路径（world 目录落盘产物），复用端口参考图解析转成 data URL，
  // 保证远端生成 API 可直接使用；无解析器时退回 data:/http(s) 白名单。
  const charRefs = ctx.resolveImageUrls
    ? (
        await ctx.resolveImageUrls(charRefUrls.map((url) => ({ dataUrl: url, relativePath: url })))
      ).filter(Boolean)
    : charRefUrls.filter((url) => url.startsWith('data:') || /^https?:\/\//i.test(url))
  const inputReferences = [...styleRefs, ...portRefs, ...charRefs]
  // 与 inputReferences 一一对应的元信息：来源（风格库/端口参考图/角色）+ 落盘相对路径/名称
  const inputReferenceMeta: GraphImageReferenceMeta[] = [
    ...styleImages.slice(0, styleRefs.length).map((item) => ({
      source: 'style' as const,
      name: item.name?.trim() || item.libraryId
    })),
    ...sourceItems.slice(0, portRefs.length).map((item) => ({
      source: 'port' as const,
      ...(item.relativePath?.trim() ? { relativePath: item.relativePath.trim() } : {})
    })),
    ...characterRefs.slice(0, charRefs.length).map((ref) => ({
      source: 'character' as const,
      name: ref.name?.trim() || undefined
    }))
  ]

  const result = await ctx.generateImage({
    prompt,
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined,
    aspectRatio: genParams.aspectRatio,
    resolution: genParams.resolution,
    quality: genParams.quality,
    n: genParams.count,
    seed: resolveGenerateSeed(node.params, ctx.resolveProjectGenerateSeed?.()),
    inputReferences: inputReferences.length ? inputReferences : undefined,
    inputReferenceMeta: inputReferenceMeta.length ? inputReferenceMeta : undefined
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const createdAt = new Date().toISOString()
  const stamp = Date.now()
  const batch: GraphImageItem[] = []
  for (const [index, url] of (result.images ?? []).entries()) {
    const dataUrl = typeof url === 'string' ? url.trim() : ''
    if (!dataUrl) continue
    batch.push({
      id: `gen:${node.id}:${stamp}:${index}`,
      dataUrl,
      createdAt
    })
  }

  if (!batch.length) {
    throw fail(SHARED_ERRORS.noModelImage)
  }

  // 按设定宽高比裁正画布：宫格画布裁正后每个格子几何上严格按该比例均分
  if (genParams.aspectRatio?.trim() && ctx.normalizeImageAspectRatio) {
    const ratio = genParams.aspectRatio.trim()
    for (const item of batch) {
      if (!item.dataUrl?.startsWith('data:image/')) continue
      try {
        const normalized = await ctx.normalizeImageAspectRatio({
          dataUrl: item.dataUrl,
          aspectRatio: ratio
        })
        if (normalized) item.dataUrl = normalized
      } catch {
        /* 裁正失败时保留原图 */
      }
    }
  }

  const stampKey = `gen:${node.id}:${stamp}`
  const materializedBatch = await materializeGeneratedBatch(ctx, batch, stampKey)
  if (!materializedBatch.length) {
    throw fail(SHARED_ERRORS.persistImageFailed, { detail: '' })
  }
  const generatedImages = mergeGeneratedImages(ctx, materializedBatch, `${stampKey}:keep`)
  return commitGeneratedImages(ctx, generatedImages, materializedBatch[0]?.relativePath?.trim())
}

/**
 * 画布上拖入的剧本资产引用。
 * 剧本优先 resolveAssetText（导入文件 URL / 新建 graphJson），否则走 genParams。
 */
