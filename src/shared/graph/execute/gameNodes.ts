/**
 * 游戏生产管线专用节点执行器（`game.pbrTile` / `game.audioDsp` / `game.levelMap` / `game.playable`）。
 *
 * 将无缝瓦片与 PBR 四通道材质派生、9-Slice 与 2D 碰撞凸包提取、游戏音频无缝循环与 4× 变体 DSP、
 * 程序化 2D 关卡地图生成（Tiled .tmj + 像素预览图）以及 60fps 可玩 HTML5 沙盒编译全部收敛为
 * 画布上可自由连线组合的标准图节点。
 */
import { buildGeneratedMediaFileKey, formatGeneratedMediaStamp } from '../../domain'
import {
  analyzeSeamlessTile,
  applyAudioShaperPcm,
  applyCustomEditsToLevelMap,
  applyEqualPowerLoopCrossfadePcm,
  applyGameAudioEnvironmentFxPcm,
  applySeamlessTileBlend,
  buildNineSliceManifest,
  buildSpritePhysicsManifest,
  compilePlayableGameSandboxHtml,
  createProceduralStoneTileRgba,
  decodeWavBytesToPcm,
  derivePbrMapsFromRgba,
  detectNineSliceBorders,
  encodePcmToWavDataUrl,
  encodeRgbaToPngDataUrl,
  generateProceduralLevelMap,
  normalizePeakPcm,
  planSfxVariantMatrix,
  renderProceduralLevelToPng,
  resamplePitchShiftPcm,
  synthesizeGameSeedPcm,
  trimSilencePcm,
  type GameAudioEnvironmentFx,
  type GameAudioSynthPreset,
  type LevelCellType,
  type LevelEntitySpawn,
  type LevelGeneratorAlgorithm,
  type PlayableSandboxMode,
  type ProceduralLevelMapResult
} from '../../gameAssets'
import {
  dualTextGalleryOutputs,
  dualVoiceGalleryOutputs,
  flattenTextValues,
  flattenTextsValues,
  flattenVoicesValues,
  newestTextSelectedId,
  newestVoiceSelectedId
} from './gallery'
import { collectIncomingValues } from './incoming'
import {
  commitGeneratedImages,
  materializeGeneratedBatch,
  materializeGeneratedText,
  mergeGeneratedImages,
  mergeGeneratedTexts,
  mergeGeneratedVoices
} from './materialize'
import { collectIncomingImageItems } from './mediaInputs'
import type {
  GraphImageItem,
  GraphTextItem,
  GraphValue,
  GraphVoiceItem,
  NodeExecuteContext
} from './types'

async function resolveFirstIncomingImageUrl(
  ctx: NodeExecuteContext,
  sourceItems: GraphImageItem[]
): Promise<string | undefined> {
  if (ctx.resolveImageUrls && sourceItems.length) {
    const urls = (await ctx.resolveImageUrls(sourceItems.slice(0, 1))).filter(Boolean)
    if (urls[0]?.trim()) return urls[0].trim()
  }
  const direct = sourceItems[0]?.dataUrl?.trim()
  if (direct) return direct
  if (ctx.resolveAssetImageUrl) {
    for (const val of [
      ...(ctx.inputs.in ?? []),
      ...(ctx.inputs['in-image'] ?? []),
      ...collectIncomingValues(ctx.inputs)
    ]) {
      if (val.kind === 'asset' && val.assetType === 'image') {
        const url = await ctx.resolveAssetImageUrl(val.assetId)
        if (url?.trim()) return url.trim()
      }
    }
  }
  return undefined
}

async function encodeRgbaWithCtx(
  ctx: NodeExecuteContext,
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): Promise<string> {
  if (ctx.uiRgbaCodec?.encodeRgbaPng) {
    try {
      const encoded = await ctx.uiRgbaCodec.encodeRgbaPng({ width, height, data: rgba })
      if (encoded?.startsWith('data:image/')) return encoded
    } catch {
      /* fallback to pure-JS PNG encoder */
    }
  }
  return encodeRgbaToPngDataUrl(rgba, width, height)
}

/**
 * `game.pbrTile`：无缝瓦片融合 + PBR 四通道贴图派生（Normal / Roughness / ORM / Height）
 * + UI 9-Slice 拉伸线检测 + 2D 物理碰撞凸包与受击/攻击盒提取。
 */
export async function executeGamePbrTileNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const sourceItems = await collectIncomingImageItems(ctx)
  const sourceUrl = await resolveFirstIncomingImageUrl(ctx, sourceItems)

  let width = 64
  let height = 64
  let rawRgba: Uint8ClampedArray

  if (sourceUrl && ctx.uiRgbaCodec?.decodeImageRgba) {
    try {
      const decoded = await ctx.uiRgbaCodec.decodeImageRgba(sourceUrl)
      width = Math.max(4, decoded.width)
      height = Math.max(4, decoded.height)
      rawRgba = new Uint8ClampedArray(decoded.data)
    } catch {
      const fallback = createProceduralStoneTileRgba(64, 64)
      width = fallback.width
      height = fallback.height
      rawRgba = fallback.data
    }
  } else {
    const fallback = createProceduralStoneTileRgba(64, 64)
    width = fallback.width
    height = fallback.height
    rawRgba = fallback.data
  }

  const tileSeamless = ctx.node.params.gameTileSeamless !== false
  const blendRatio = Math.max(
    0.05,
    Math.min(0.45, Number(ctx.node.params.gameTileBlendRatio ?? 0.22))
  )
  const normalStrength = Math.max(
    0.5,
    Math.min(8, Number(ctx.node.params.gamePbrNormalStrength ?? 2.8))
  )
  const invertRoughness = Boolean(ctx.node.params.gamePbrInvertRoughness)

  const seamBefore = analyzeSeamlessTile(rawRgba, width, height)
  const baseRgba = tileSeamless
    ? applySeamlessTileBlend(rawRgba, width, height, { blendRatio })
    : rawRgba
  const seamAfter = analyzeSeamlessTile(baseRgba, width, height)

  const pbrMaps = derivePbrMapsFromRgba(baseRgba, width, height, {
    normalStrength,
    invertRoughness,
    aoStrength: 0.75
  })

  const nineSlice = detectNineSliceBorders(baseRgba, width, height)
  const nineSliceManifest = buildNineSliceManifest(ctx.node.title || 'sprite', nineSlice)
  const physicsManifest = buildSpritePhysicsManifest(
    ctx.node.title || 'sprite',
    baseRgba,
    width,
    height
  )

  const stamp = Date.now()
  const createdAt = new Date().toISOString()

  const [albedoUrl, normalUrl, roughnessUrl, ormUrl, heightUrl] = await Promise.all([
    encodeRgbaWithCtx(ctx, baseRgba, width, height),
    encodeRgbaWithCtx(ctx, pbrMaps.normal, width, height),
    encodeRgbaWithCtx(ctx, pbrMaps.roughness, width, height),
    encodeRgbaWithCtx(ctx, pbrMaps.orm, width, height),
    encodeRgbaWithCtx(ctx, pbrMaps.heightMap, width, height)
  ])

  const rawBatch: GraphImageItem[] = [
    {
      id: `pbr:${ctx.node.id}:${stamp}:albedo`,
      title: tileSeamless ? 'Seamless_Albedo' : 'Base_Albedo',
      dataUrl: albedoUrl,
      createdAt
    },
    {
      id: `pbr:${ctx.node.id}:${stamp}:normal`,
      title: 'PBR_Normal',
      dataUrl: normalUrl,
      createdAt
    },
    {
      id: `pbr:${ctx.node.id}:${stamp}:roughness`,
      title: 'PBR_Roughness',
      dataUrl: roughnessUrl,
      createdAt
    },
    {
      id: `pbr:${ctx.node.id}:${stamp}:orm`,
      title: 'PBR_ORM',
      dataUrl: ormUrl,
      createdAt
    },
    {
      id: `pbr:${ctx.node.id}:${stamp}:height`,
      title: 'PBR_Height',
      dataUrl: heightUrl,
      createdAt
    }
  ]

  const materialized = await materializeGeneratedBatch(ctx, rawBatch, `pbr:${ctx.node.id}:${stamp}`)
  const generatedImages = mergeGeneratedImages(
    ctx,
    materialized,
    `pbr:${ctx.node.id}:${stamp}:keep`
  )

  const b = nineSlice.borders
  const hullVerts = physicsManifest.hull.verticesPx.length
  const reportObj = {
    resolution: `${width}x${height}`,
    tileSeamless,
    seamScoreBefore: seamBefore.score,
    seamScoreAfter: seamAfter.score,
    maps: ['Seamless_Albedo', 'PBR_Normal', 'PBR_Roughness', 'PBR_ORM', 'PBR_Height'],
    nineSlice: b,
    collisionHullVertices: hullVerts,
    pivot: physicsManifest.hull.pivot
  }
  const reportJson = JSON.stringify(
    {
      summary: reportObj,
      nineSlice: nineSliceManifest,
      physics: physicsManifest
    },
    null,
    2
  )

  const outputs = commitGeneratedImages(
    ctx,
    generatedImages,
    materialized[0]?.relativePath?.trim(),
    {
      gameTileSeamless: tileSeamless,
      gameTileBlendRatio: blendRatio,
      gamePbrNormalStrength: normalStrength,
      gamePbrInvertRoughness: invertRoughness,
      gamePbrReport: `${width}x${height} | SeamScore ${seamBefore.score} -> ${seamAfter.score} | 9-Slice [T:${b.top} B:${b.bottom} L:${b.left} R:${b.right}] | Hull ${hullVerts}v`
    }
  )
  outputs['out-meta'] = {
    kind: 'text',
    text: reportJson
  }
  return outputs
}

function base64ToUint8Array(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'))
  }
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i)
  }
  return out
}

async function resolveIncomingAudioPcm(
  ctx: NodeExecuteContext,
  mode: 'loop_bgm' | 'sfx_variants'
): Promise<{ channels: Float32Array[]; sampleRate: number; sourceName: string }> {
  const incoming = [
    ...(ctx.inputs.in ?? []),
    ...(ctx.inputs['in-voice'] ?? []),
    ...collectIncomingValues(ctx.inputs)
  ]
  const voiceItems = flattenVoicesValues(incoming)
  let relativePath = voiceItems[0]?.relativePath?.trim()
  let assetId = voiceItems[0]?.id?.trim()

  if (!relativePath && !assetId) {
    for (const v of incoming) {
      if (v.kind === 'asset' && v.assetType === 'voice') {
        assetId = v.assetId
        relativePath = v.relativePath
        break
      }
    }
  }

  let mediaUrl: string | undefined
  if (relativePath && ctx.resolveProjectMediaUrl) {
    mediaUrl = await ctx.resolveProjectMediaUrl(relativePath)
  }
  if (!mediaUrl && assetId && ctx.resolveAssetMediaUrl) {
    mediaUrl = await ctx.resolveAssetMediaUrl(assetId)
  }

  if (mediaUrl?.startsWith('data:audio/wav;base64,')) {
    const b64 = mediaUrl.slice('data:audio/wav;base64,'.length)
    const decoded = decodeWavBytesToPcm(base64ToUint8Array(b64))
    if (decoded && decoded.channels.length) {
      return {
        ...decoded,
        sourceName: relativePath ? relativePath.split('/').pop() || 'audio' : 'audio'
      }
    }
  }

  if (
    mediaUrl &&
    typeof window !== 'undefined' &&
    typeof fetch === 'function' &&
    (window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
  ) {
    try {
      const resp = await fetch(mediaUrl)
      const arrayBuf = await resp.arrayBuffer()
      const wavDirect = decodeWavBytesToPcm(new Uint8Array(arrayBuf))
      if (wavDirect && wavDirect.channels.length) {
        return {
          ...wavDirect,
          sourceName: relativePath ? relativePath.split('/').pop() || 'audio' : 'audio'
        }
      }
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const audioCtx = new AudioCtx()
      try {
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuf.slice(0))
        const numCh = Math.min(2, audioBuffer.numberOfChannels)
        const channels: Float32Array[] = []
        for (let ch = 0; ch < numCh; ch++) {
          channels.push(new Float32Array(audioBuffer.getChannelData(ch)))
        }
        return {
          channels,
          sampleRate: audioBuffer.sampleRate,
          sourceName: relativePath ? relativePath.split('/').pop() || 'audio' : 'audio'
        }
      } finally {
        void audioCtx.close().catch(() => {})
      }
    } catch {
      /* fallback to procedural seed synth */
    }
  }

  const preset: GameAudioSynthPreset =
    ctx.node.params.gameAudioSynthPreset ?? (mode === 'loop_bgm' ? 'chiptune_bgm' : 'sword_slash')
  const synth = synthesizeGameSeedPcm(
    mode === 'loop_bgm' && !ctx.node.params.gameAudioSynthPreset ? 'chiptune_bgm' : preset,
    22050
  )
  return {
    ...synth,
    sourceName: mode === 'loop_bgm' ? 'bgm_synth' : `${preset}_synth`
  }
}

/**
 * `game.audioDsp`：游戏音频工坊节点。
 * - `loop_bgm`：对输入音频执行等功率正余弦首尾交叉淡化（Equal-Power Loop Crossfade），消除循环接缝爆音；
 * - `sfx_variants`：首尾静音自动修剪（0ms 瞬态触发）+ N× Hermite 三次插值变调变速防听觉疲劳派生；
 * - 支持 6 类游戏声学环境滤镜（`underwater` / `radio_comms` / `cave_reverb` / `retro_8bit` / `heavy_impact`）与 -1dBFS 峰值归一化。
 */
export async function executeGameAudioDspNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const mode: 'loop_bgm' | 'sfx_variants' =
    ctx.node.params.gameAudioDspMode === 'sfx_variants' ? 'sfx_variants' : 'loop_bgm'
  const crossfadeSec = Math.max(
    0.1,
    Math.min(8, Number(ctx.node.params.gameAudioCrossfadeSec ?? 1.5))
  )
  const trimThresholdDb = Math.max(
    -70,
    Math.min(-18, Number(ctx.node.params.gameAudioTrimThresholdDb ?? -42))
  )
  const variantCount = Math.max(
    1,
    Math.min(8, Math.round(Number(ctx.node.params.gameAudioVariantCount ?? 4)))
  )
  const pitchSpread = Math.max(
    0.2,
    Math.min(6, Number(ctx.node.params.gameAudioPitchSpread ?? 2.2))
  )
  const envFx: GameAudioEnvironmentFx = ctx.node.params.gameAudioEnvFx ?? 'none'
  const normalize = ctx.node.params.gameAudioNormalize !== false
  const highPassHz = Math.max(20, Math.min(1200, Number(ctx.node.params.gameAudioHighPassHz ?? 20)))
  const lowPassHz = Math.max(
    800,
    Math.min(20000, Number(ctx.node.params.gameAudioLowPassHz ?? 20000))
  )
  const releaseTighten = Math.max(
    0,
    Math.min(0.85, Number(ctx.node.params.gameAudioReleaseTighten ?? 0))
  )

  const { channels, sampleRate, sourceName } = await resolveIncomingAudioPcm(ctx, mode)
  const baseStem = sourceName.replace(/\.[^.]+$/, '') || 'game_audio'
  const stamp = formatGeneratedMediaStamp()
  const createdAt = new Date().toISOString()
  const batch: GraphVoiceItem[] = []
  let report = ''

  const postProcessChannel = (ch: Float32Array): Float32Array => {
    const shaped = applyAudioShaperPcm(ch, sampleRate, {
      highPassHz,
      lowPassHz,
      releaseTighten
    })
    const withFx =
      envFx !== 'none' ? applyGameAudioEnvironmentFxPcm(shaped, sampleRate, envFx) : shaped
    return normalize ? normalizePeakPcm(withFx, -1.0) : withFx
  }

  if (mode === 'loop_bgm') {
    const loopedChannels = channels.map((ch) =>
      postProcessChannel(applyEqualPowerLoopCrossfadePcm(ch, sampleRate, crossfadeSec))
    )
    const wavDataUrl = encodePcmToWavDataUrl(loopedChannels, sampleRate)
    let relativePath = `Cache/Voices/${baseStem}_loop_${stamp}.wav`
    if (ctx.saveRunMedia) {
      const saved = await ctx.saveRunMedia({
        dataUrl: wavDataUrl,
        key: buildGeneratedMediaFileKey({
          hostAssetName: ctx.resolveHostAssetName?.(),
          nodeTitle: `${baseStem}_loop`,
          stamp
        }),
        outputDir: ctx.node.params.mediaOutputDir?.trim() || 'Assets/GameAudio',
        node: ctx.node
      })
      if (saved?.trim()) relativePath = saved.trim()
    }
    batch.push({
      id: `audio-dsp:${ctx.node.id}:${stamp}:loop`,
      createdAt,
      relativePath
    })
    const outDurationSec = ((loopedChannels[0]?.length ?? 0) / sampleRate).toFixed(2)
    report = `Loop BGM | ${outDurationSec}s @ ${sampleRate}Hz | Crossfade ${crossfadeSec}s | FX: ${envFx} -> ${relativePath}`
  } else {
    const trimmedChannels = channels.map((ch) =>
      trimSilencePcm(ch, sampleRate, { thresholdDb: trimThresholdDb })
    )
    const variants = planSfxVariantMatrix({
      count: variantCount,
      pitchSpreadSemitones: pitchSpread,
      tempoSpread: 0.08
    })
    for (const v of variants) {
      const shiftedChannels = trimmedChannels.map((ch) =>
        postProcessChannel(resamplePitchShiftPcm(ch, v.semitoneOffset, v.trebleGainDb))
      )
      const wavDataUrl = encodePcmToWavDataUrl(shiftedChannels, sampleRate)
      const outStem = `${baseStem}_${v.variantId}`
      let relativePath = `Cache/Voices/${outStem}_${stamp}.wav`
      if (ctx.saveRunMedia) {
        const saved = await ctx.saveRunMedia({
          dataUrl: wavDataUrl,
          key: buildGeneratedMediaFileKey({
            hostAssetName: ctx.resolveHostAssetName?.(),
            nodeTitle: outStem,
            stamp
          }),
          outputDir: ctx.node.params.mediaOutputDir?.trim() || 'Assets/GameAudio',
          node: ctx.node
        })
        if (saved?.trim()) relativePath = saved.trim()
      }
      batch.push({
        id: `audio-dsp:${ctx.node.id}:${stamp}:${v.variantId}`,
        createdAt,
        relativePath
      })
    }
    report = `${variantCount}x SFX Variants | Trim ${trimThresholdDb}dB | Pitch +/-${pitchSpread}st | FX: ${envFx} @ ${sampleRate}Hz`
  }

  const generatedVoices = mergeGeneratedVoices(ctx, batch, `audio-dsp:${stamp}:keep`)
  const selectedVoiceId = newestVoiceSelectedId(generatedVoices)
  const previewRelativePath = batch[0]?.relativePath?.trim() || undefined
  const patchParams = {
    generatedVoices,
    selectedVoiceId,
    gameAudioDspMode: mode,
    gameAudioCrossfadeSec: crossfadeSec,
    gameAudioTrimThresholdDb: trimThresholdDb,
    gameAudioVariantCount: variantCount,
    gameAudioPitchSpread: pitchSpread,
    gameAudioEnvFx: envFx,
    gameAudioNormalize: normalize,
    gameAudioReport: report,
    ...(previewRelativePath ? { previewRelativePath } : {})
  }
  ctx.node.params = { ...ctx.node.params, ...patchParams }
  ctx.patchNode?.({ params: patchParams })

  return dualVoiceGalleryOutputs(generatedVoices, selectedVoiceId)
}

/**
 * `game.levelMap`：程序化 2D 关卡生成节点。
 * 同时产出高对比度 2D 关卡像素预览图（`out` / `out-all`）与标准 Tiled `.tmj` JSON（`out-text`）。
 */
export async function executeGameLevelMapNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const algorithmRaw = ctx.node.params.gameLevelAlgorithm ?? 'bsp_dungeon'
  const algorithm: LevelGeneratorAlgorithm =
    algorithmRaw === 'cellular_cave' ||
    algorithmRaw === 'arena_waves' ||
    algorithmRaw === 'platformer_course'
      ? algorithmRaw
      : 'bsp_dungeon'
  const width = Math.max(12, Math.min(64, Math.floor(Number(ctx.node.params.gameLevelWidth ?? 32))))
  const height = Math.max(
    10,
    Math.min(48, Math.floor(Number(ctx.node.params.gameLevelHeight ?? 20)))
  )
  const seed = Math.floor(Number(ctx.node.params.gameLevelSeed ?? 1337))

  const baseLevel = generateProceduralLevelMap({
    algorithm,
    width,
    height,
    seed
  })
  const level = applyCustomEditsToLevelMap(baseLevel, ctx.node.params.gameLevelCustomEdits)
  const tmjJson = level.tiledTmjText
  const rendered = renderProceduralLevelToPng(level, 12)
  const previewDataUrl = await encodeRgbaWithCtx(
    ctx,
    rendered.data,
    rendered.width,
    rendered.height
  )

  const stamp = Date.now()
  const createdAt = new Date().toISOString()
  const rawItem: GraphImageItem = {
    id: `level:${ctx.node.id}:${stamp}`,
    title: `${algorithm}_${width}x${height}_seed${seed}`,
    dataUrl: previewDataUrl,
    createdAt
  }

  const materialized = await materializeGeneratedBatch(
    ctx,
    [rawItem],
    `level:${ctx.node.id}:${stamp}`
  )
  const generatedImages = mergeGeneratedImages(
    ctx,
    materialized,
    `level:${ctx.node.id}:${stamp}:keep`
  )

  let tmjRelativePath: string | undefined
  if (ctx.saveRunText) {
    try {
      tmjRelativePath = await ctx.saveRunText({
        content: tmjJson,
        key: `level_${algorithm}_${width}x${height}_${seed}`,
        outputDir: ctx.node.params.mediaOutputDir?.trim() || 'Assets/LevelMaps',
        node: ctx.node
      })
    } catch {
      /* ignore text persist error */
    }
  }

  const report = `${algorithm} | ${width}x${height} (Seed ${seed}) | Rooms: ${level.rooms.length} | Entities: ${level.entities.length}`
  const outputs = commitGeneratedImages(
    ctx,
    generatedImages,
    materialized[0]?.relativePath?.trim(),
    {
      gameLevelAlgorithm: algorithm,
      gameLevelWidth: width,
      gameLevelHeight: height,
      gameLevelSeed: seed,
      gameLevelReport: report,
      text: tmjJson
    }
  )

  outputs['out-text'] = {
    kind: 'text',
    text: tmjJson,
    ...(tmjRelativePath ? { relativePath: tmjRelativePath } : {})
  }
  return outputs
}

function tryParseTiledJsonToLevelMap(rawText: string): ProceduralLevelMapResult | null {
  try {
    const parsed = JSON.parse(rawText) as {
      type?: string
      width?: number
      height?: number
      tilewidth?: number
      tileheight?: number
      layers?: Array<{
        type?: string
        name?: string
        data?: number[]
        objects?: Array<{
          id?: number
          name?: string
          type?: string
          x?: number
          y?: number
        }>
      }>
    }
    if (parsed?.type !== 'map' || !Array.isArray(parsed.layers)) return null
    const w = Math.max(8, Math.floor(Number(parsed.width ?? 0)))
    const h = Math.max(8, Math.floor(Number(parsed.height ?? 0)))
    const tileW = Math.max(8, Math.floor(Number(parsed.tilewidth ?? 32)))
    const tileH = Math.max(8, Math.floor(Number(parsed.tileheight ?? 32)))
    const tileLayer = parsed.layers.find((l) => l.type === 'tilelayer' && Array.isArray(l.data))
    if (!tileLayer?.data || tileLayer.data.length < w * h) return null

    const grid: LevelCellType[][] = []
    for (let y = 0; y < h; y++) {
      const row: LevelCellType[] = []
      for (let x = 0; x < w; x++) {
        const gid = tileLayer.data[y * w + x] ?? 0
        if (gid === 0) row.push('wall')
        else if (gid === 17) row.push('platform')
        else if (gid === 18) row.push('hazard')
        else row.push('floor')
      }
      grid.push(row)
    }

    const objLayer = parsed.layers.find((l) => l.type === 'objectgroup' && Array.isArray(l.objects))
    const entities: LevelEntitySpawn[] = []
    if (objLayer?.objects) {
      for (const [idx, obj] of objLayer.objects.entries()) {
        const typeRaw = (obj.type || obj.name || 'enemy_spawn') as LevelEntitySpawn['type']
        const px = Number(obj.x ?? tileW)
        const py = Number(obj.y ?? tileH)
        entities.push({
          id: `ent_${idx}`,
          type: typeRaw,
          gridX: Math.max(1, Math.min(w - 2, Math.floor(px / tileW))),
          gridY: Math.max(1, Math.min(h - 2, Math.floor(py / tileH))),
          pixelX: px,
          pixelY: py
        })
      }
    }

    const base = generateProceduralLevelMap({
      algorithm: 'bsp_dungeon',
      width: w,
      height: h,
      tileWidth: tileW,
      tileHeight: tileH,
      seed: 1337
    })
    return {
      ...base,
      grid,
      entities: entities.length ? entities : base.entities,
      tiledTmjText: rawText
    }
  } catch {
    return null
  }
}

/**
 * `game.playable`：可玩游戏沙盒编译节点。
 * 接收上游连接的角色/怪物/瓦片精灵图（`in-image`）、关卡地图 `.tmj` JSON（`in-text`）与音效（`in-voice`），
 * 编译为单文件零依赖 60fps HTML5 微型可玩原型（支持 WASD 移动、空格冲刺、鼠标攻击、波次刷怪、粒子与合成音效）。
 */
export async function executeGamePlayableNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const sourceImages = await collectIncomingImageItems(ctx)
  let resolvedUrls: string[] = []
  if (sourceImages.length) {
    if (ctx.resolveImageUrls) {
      resolvedUrls = await ctx.resolveImageUrls(sourceImages)
    } else {
      resolvedUrls = sourceImages.map((item) => item.dataUrl?.trim() || '')
    }
  }

  let playerSpriteDataUrl: string | undefined
  let enemySpriteDataUrl: string | undefined
  let tileSpriteDataUrl: string | undefined

  for (let i = 0; i < sourceImages.length; i++) {
    const url = resolvedUrls[i]?.trim() || sourceImages[i]?.dataUrl?.trim()
    if (!url) continue
    const title = (sourceImages[i]?.title || '').toLowerCase()
    if (!enemySpriteDataUrl && /(enemy|monster|boss|slime|goblin)/.test(title)) {
      enemySpriteDataUrl = url
    } else if (!tileSpriteDataUrl && /(tile|floor|ground|brick|wall|albedo)/.test(title)) {
      tileSpriteDataUrl = url
    } else if (!playerSpriteDataUrl) {
      playerSpriteDataUrl = url
    } else if (!enemySpriteDataUrl) {
      enemySpriteDataUrl = url
    } else if (!tileSpriteDataUrl) {
      tileSpriteDataUrl = url
    }
  }

  // Check incoming text ports for Tiled .tmj JSON from game.levelMap
  const textInputs = [
    ...(ctx.inputs['in-text'] ?? []),
    ...(ctx.inputs.in ?? []),
    ...collectIncomingValues(ctx.inputs)
  ]
  const textCandidates = [
    ...flattenTextValues(textInputs).map((t) => t.text),
    ...flattenTextsValues(textInputs).map((t) => t.text)
  ].filter(Boolean)

  let levelMap: ProceduralLevelMapResult | null = null
  for (const candidate of textCandidates) {
    const parsed = tryParseTiledJsonToLevelMap(candidate)
    if (parsed) {
      levelMap = parsed
      break
    }
  }

  const algorithmRaw = ctx.node.params.gameLevelAlgorithm ?? 'bsp_dungeon'
  const algorithm: LevelGeneratorAlgorithm =
    algorithmRaw === 'cellular_cave' ||
    algorithmRaw === 'arena_waves' ||
    algorithmRaw === 'platformer_course'
      ? algorithmRaw
      : 'bsp_dungeon'
  const seed = Math.floor(Number(ctx.node.params.gameLevelSeed ?? 42))

  const genreRaw = ctx.node.params.gamePlayableGenre ?? 'roguelike_action'
  const cameraRaw = ctx.node.params.gamePlayableCameraMode ?? 'topdown_34'
  const mode: PlayableSandboxMode =
    genreRaw === 'platformer' || cameraRaw === 'side_view' ? 'platformer' : 'survivor'

  if (!levelMap) {
    levelMap = generateProceduralLevelMap({
      algorithm: mode === 'platformer' ? 'platformer_course' : algorithm,
      width: 32,
      height: 20,
      seed
    })
  }

  const title =
    ctx.node.params.gamePlayableTitle?.trim() || ctx.node.title?.trim() || 'Indie Game Prototype'

  const compiled = compilePlayableGameSandboxHtml({
    title,
    mode,
    levelSeed: seed,
    playerSpriteDataUrl,
    enemySpriteDataUrl,
    tileSpriteDataUrl,
    levelMap
  })
  const html = compiled.html

  const stamp = formatGeneratedMediaStamp()
  const createdAt = new Date().toISOString()
  const id = `playable:${ctx.node.id}:${stamp}`
  const materialized = await materializeGeneratedText(ctx, html, id, createdAt, {
    title: `${title}_Playable`,
    stamp
  })
  const batch: GraphTextItem[] = [materialized]
  const generatedTexts = mergeGeneratedTexts(ctx, batch, `${stamp}:keep`)
  const selectedTextId = newestTextSelectedId(generatedTexts)

  const spriteCount = [playerSpriteDataUrl, enemySpriteDataUrl, tileSpriteDataUrl].filter(
    Boolean
  ).length
  const report = `${title} | ${genreRaw} (${cameraRaw}) | Map ${levelMap.width}x${levelMap.height} | Sprites: ${spriteCount} connected`

  const patchParams = {
    text: html,
    generatedTexts,
    selectedTextId,
    gamePlayableTitle: title,
    gamePlayableGenre: genreRaw,
    gamePlayableCameraMode: cameraRaw,
    gamePlayableHtml: html,
    gamePlayableReport: report
  }
  ctx.node.params = { ...ctx.node.params, ...patchParams }
  ctx.patchNode?.({ params: patchParams })

  return dualTextGalleryOutputs(generatedTexts, selectedTextId)
}
