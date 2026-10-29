/**
 * 游戏生产管线专用节点执行器（`game.pbrTile` / `game.audioDsp` / `game.levelMap`）。
 *
 * 将无缝瓦片与 PBR 四通道材质派生、9-Slice 与 2D 碰撞凸包提取、游戏音频无缝循环与 4× 变体 DSP、
 * 程序化 2D 关卡地图生成（Tiled .tmj + 像素预览图）全部收敛为画布上可自由连线组合的标准图节点。
 */
import { buildGeneratedMediaFileKey, formatGeneratedMediaStamp } from '../../domain'
import {
  analyzeLevelConnectivityAndPacing,
  analyzeSeamlessTile,
  applyAudioShaperPcm,
  applyBorderFloodColorKey,
  applyCustomEditsToLevelMap,
  applyEqualPowerLoopCrossfadePcm,
  applyGameAudioEnvironmentFxPcm,
  applySeamlessTileBlend,
  buildAutoTileAtlasManifest,
  buildBitmapFontManifest,
  buildNineSliceManifest,
  buildSpritePhysicsManifest,
  buildThemedArtboardSuitePayload,
  composeLayeredFrameTemplate,
  compositeIconWithRarityFrame,
  createProceduralMaterialTileRgba,
  createProceduralSpriteSampleRgba,
  createProceduralUiSampleRgba,
  createProceduralVfxSampleRgba,
  decodeWavBytesToPcm,
  derivePbrMapsFromRgba,
  deriveSecondaryTerrainTileRgba,
  detectNineSliceBorders,
  encodePcmToWavDataUrl,
  encodeRgbaToPngDataUrl,
  exportGodotNinePatchTscn,
  exportGodotTileSetTres,
  exportGodotUiButtonThemeTres,
  exportUnityNineSliceSnippet,
  exportWebCssNineSliceSnippet,
  FULL_UI_SUITE_BLUEPRINTS,
  generateProceduralLevelMap,
  generateUiButtonFourStates,
  hasNativeTransparentPixels,
  type IconRarityTier,
  normalizeIntegratedLufsPcm,
  normalizePeakPcm,
  planSfxVariantMatrix,
  processScenePropWithYSortAndShadow,
  processSpriteStrokeAndMipChain,
  renderProceduralLevelToPng,
  resamplePitchShiftPcm,
  sliceNinePatchRegionsRgba,
  splitBgmIntroAndSeamlessLoop,
  type SpriteStrokeColorPreset,
  synthesizeGameSeedPcm,
  synthesizeDialogueBoxKit,
  synthesizeFullScreenUiArtboardRgba,
  synthesizeHudProgressBarKit,
  synthesizeRadialHudKit,
  synthesizeUiAssetKitShowcaseRgba,
  synthesizeUiFormControlsKit,
  synthesizeVfxFlipbookPipeline,
  synthesizeWang16AutoTileAtlas,
  trimSilencePcm,
  type HudBarColorPreset,
  type NineSliceStretchMode,
  type UiScreenBlueprintPreset,
  type UiStylePreset,
  type UniversalFrameShape,
  type VfxElementalPalette,
  type VfxProductionMode,
  type GameAudioEnvironmentFx,
  type GameAudioSynthPreset,
  type LevelGeneratorAlgorithm,
  analyzeMxEconomyHealth,
  analyzeMultiplierPipeline,
  createMxWorkbenchPreset,
  generateMxAgentWithAi,
  matchMxTemplateFromPrompt,
  MX_TEMPLATES,
  type MxDocument,
  type MxTemplateId,
  parseMxDocumentJson,
  type PbrMaterialPreset,
  renderMxPreviewRgba,
  runMxCombatKernelSimulation,
  runMxForecast,
  runMxLootAndSubstatSimulation,
  runMxRoguelikeEnvelopeSimulation,
  runMxSimulation,
  synthesizeMxDiagramFromPrompt,
  exportMxForecastCsv,
  exportMxGodotGd,
  exportMxToMermaid,
  exportMxUnityCs
} from '../../gameAssets'
import {
  dualVoiceGalleryOutputs,
  flattenTextValues,
  flattenTextsValues,
  flattenVoicesValues,
  newestVoiceSelectedId,
  stripEmbeddedImageData
} from './gallery'
import { collectIncomingValues } from './incoming'
import {
  commitGeneratedImages,
  materializeGeneratedBatch,
  mergeGeneratedImages,
  mergeGeneratedVoices
} from './materialize'
import { collectIncomingImageItems } from './mediaInputs'
import type { GraphImageItem, GraphValue, GraphVoiceItem, NodeExecuteContext } from './types'

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
function normalizeUiStylePreset(raw: unknown): UiStylePreset {
  if (
    raw === 'royal_gold_enamel' ||
    raw === 'arcane_crystal' ||
    raw === 'cyber_holo_grid' ||
    raw === 'ink_paper_cel' ||
    raw === 'celestial_star_gold' ||
    raw === 'persona_rebel_red' ||
    raw === 'minimal_ark_tech'
  ) {
    return raw
  }
  return 'dark_iron_parchment'
}

export async function executeGamePbrTileNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const sourceItems = await collectIncomingImageItems(ctx)
  const sourceUrl = await resolveFirstIncomingImageUrl(ctx, sourceItems)

  let width = 64
  let height = 64
  let rawRgba: Uint8ClampedArray

  const defaultModeForNode =
    ctx.node.typeId === 'game.spriteProp'
      ? 'sprite_stroke_mip'
      : ctx.node.typeId === 'game.vfxAlpha'
        ? 'vfx_demult'
        : 'pbr_tile'
  const assetMode = ctx.node.params.gamePbrAssetMode ?? defaultModeForNode
  const materialPreset: PbrMaterialPreset = ctx.node.params.gamePbrMaterialPreset ?? 'stone_dungeon'

  const createProceduralFallback = (): {
    width: number
    height: number
    data: Uint8ClampedArray
  } => {
    if (
      assetMode === 'composite_frame' ||
      assetMode === 'ui_full_suite' ||
      assetMode === 'ui_kit' ||
      assetMode === 'raw_nine_slice' ||
      assetMode === 'hud_bar_kit' ||
      assetMode === 'radial_hud_kit' ||
      assetMode === 'dialogue_kit' ||
      assetMode === 'ui_controls_kit'
    ) {
      return createProceduralUiSampleRgba(
        64,
        64,
        assetMode === 'ui_kit' ? 'ui_kit' : 'composite_frame'
      )
    }
    if (assetMode === 'sprite_stroke_mip' || assetMode === 'scene_prop') {
      return createProceduralSpriteSampleRgba(64, 64, assetMode)
    }
    if (assetMode === 'vfx_demult') {
      const archetypeRaw = ctx.node.params.gameVfxArchetype ?? 'slash_arc'
      return createProceduralVfxSampleRgba(128, 128, archetypeRaw)
    }
    return createProceduralMaterialTileRgba(materialPreset, 64, 64)
  }

  if (sourceUrl && ctx.uiRgbaCodec?.decodeImageRgba) {
    try {
      const decoded = await ctx.uiRgbaCodec.decodeImageRgba(sourceUrl)
      width = Math.max(4, decoded.width)
      height = Math.max(4, decoded.height)
      rawRgba = new Uint8ClampedArray(decoded.data)
    } catch {
      const fallback = createProceduralFallback()
      width = fallback.width
      height = fallback.height
      rawRgba = fallback.data
    }
  } else {
    const fallback = createProceduralFallback()
    width = fallback.width
    height = fallback.height
    rawRgba = fallback.data
  }

  const isTileMode = assetMode === 'pbr_tile' || assetMode === 'autotile_wang16'
  const tileSeamless = isTileMode && ctx.node.params.gameTileSeamless !== false
  const blendRatio = Math.max(
    0.05,
    Math.min(0.45, Number(ctx.node.params.gameTileBlendRatio ?? 0.22))
  )
  const normalStrength = Math.max(
    0.5,
    Math.min(8, Number(ctx.node.params.gamePbrNormalStrength ?? 2.8))
  )
  const normalFormat = ctx.node.params.gamePbrNormalFormat === 'directx' ? 'directx' : 'opengl'
  const roughnessContrast = Math.max(
    0.2,
    Math.min(3, Number(ctx.node.params.gamePbrRoughnessContrast ?? 1.2))
  )
  const aoStrength = Math.max(0, Math.min(2, Number(ctx.node.params.gamePbrAoStrength ?? 0.75)))
  const metallicScale = Math.max(
    0,
    Math.min(2, Number(ctx.node.params.gamePbrMetallicScale ?? 0.25))
  )
  const invertRoughness = Boolean(ctx.node.params.gamePbrInvertRoughness)
  const maxHullVertices = Math.max(
    4,
    Math.min(16, Math.round(Number(ctx.node.params.gamePbrMaxHullVertices ?? 8)))
  )
  const pivotMode =
    ctx.node.params.gamePbrPivotMode === 'center' || ctx.node.params.gamePbrPivotMode === 'top_left'
      ? ctx.node.params.gamePbrPivotMode
      : 'bottom_center'

  const seamBefore = analyzeSeamlessTile(rawRgba, width, height)
  const baseRgba = tileSeamless
    ? applySeamlessTileBlend(rawRgba, width, height, { blendRatio })
    : rawRgba
  const seamAfter = analyzeSeamlessTile(baseRgba, width, height)

  const pbrMaps = derivePbrMapsFromRgba(baseRgba, width, height, {
    normalStrength,
    normalFormat,
    roughnessContrast,
    aoStrength,
    metallicScale,
    invertRoughness
  })

  const autoNineSlice = detectNineSliceBorders(baseRgba, width, height)
  const customBorders = {
    left:
      ctx.node.params.gameNineSliceLeft != null
        ? Math.max(
            0,
            Math.min(
              Math.floor(width / 2) - 1,
              Math.round(Number(ctx.node.params.gameNineSliceLeft))
            )
          )
        : autoNineSlice.borders.left,
    right:
      ctx.node.params.gameNineSliceRight != null
        ? Math.max(
            0,
            Math.min(
              Math.floor(width / 2) - 1,
              Math.round(Number(ctx.node.params.gameNineSliceRight))
            )
          )
        : autoNineSlice.borders.right,
    top:
      ctx.node.params.gameNineSliceTop != null
        ? Math.max(
            0,
            Math.min(
              Math.floor(height / 2) - 1,
              Math.round(Number(ctx.node.params.gameNineSliceTop))
            )
          )
        : autoNineSlice.borders.top,
    bottom:
      ctx.node.params.gameNineSliceBottom != null
        ? Math.max(
            0,
            Math.min(
              Math.floor(height / 2) - 1,
              Math.round(Number(ctx.node.params.gameNineSliceBottom))
            )
          )
        : autoNineSlice.borders.bottom
  }
  const nineSlice = {
    ...autoNineSlice,
    borders: customBorders,
    centerRect: {
      x: customBorders.left,
      y: customBorders.top,
      width: Math.max(1, width - customBorders.left - customBorders.right),
      height: Math.max(1, height - customBorders.top - customBorders.bottom)
    }
  }
  const nineSliceManifest = buildNineSliceManifest(ctx.node.title || 'sprite', nineSlice)
  const physicsManifest = buildSpritePhysicsManifest(
    ctx.node.title || 'sprite',
    baseRgba,
    width,
    height,
    { maxVertices: maxHullVertices, pivotMode }
  )

  const stamp = Date.now()
  const createdAt = new Date().toISOString()

  const replaceNodeGeneratedImages = (
    materialized: GraphImageItem[],
    extraParams?: Record<string, unknown>
  ): Record<string, GraphValue> => {
    const generatedImages = materialized.map(stripEmbeddedImageData)
    return commitGeneratedImages(ctx, generatedImages, materialized[0]?.relativePath?.trim(), {
      ...(materialized[0]?.id ? { selectedImageId: materialized[0].id } : {}),
      ...extraParams
    })
  }

  const decodeSecondarySources = async (): Promise<
    Array<{ width: number; height: number; data: Uint8ClampedArray }>
  > => {
    const secondary: Array<{
      width: number
      height: number
      data: Uint8ClampedArray
    }> = []
    if (sourceItems.length > 1 && ctx.uiRgbaCodec?.decodeImageRgba) {
      const extraSlices = sourceItems.slice(1, 5)
      for (let i = 0; i < extraSlices.length; i++) {
        const extraUrl = await resolveFirstIncomingImageUrl(ctx, [extraSlices[i]!])
        if (!extraUrl) continue
        try {
          const dec = await ctx.uiRgbaCodec.decodeImageRgba(extraUrl)
          if (dec.width >= 4 && dec.height >= 4) {
            secondary.push({
              width: dec.width,
              height: dec.height,
              data: new Uint8ClampedArray(dec.data)
            })
          }
        } catch {
          // ignore decode error on extra source
        }
      }
    }
    return secondary
  }

  const populateUiContainerComponentPorts = async (
    _outputs: Record<string, GraphValue>,
    _stylePreset: UiStylePreset,
    _rarityTier: IconRarityTier = 'legendary'
  ): Promise<void> => {
    // Legacy UI container component ports removed; UI screens & 9-slice controls are handled by ui.gen + image.layerSplit
  }

  if (assetMode === 'autotile_wang16') {
    let secondaryRgba: Uint8ClampedArray | undefined
    if (sourceItems.length > 1 && ctx.uiRgbaCodec?.decodeImageRgba) {
      const secondUrl = await resolveFirstIncomingImageUrl(ctx, sourceItems.slice(1, 2))
      if (secondUrl) {
        try {
          const decoded2 = await ctx.uiRgbaCodec.decodeImageRgba(secondUrl)
          if (decoded2.width === width && decoded2.height === height) {
            secondaryRgba = applySeamlessTileBlend(
              new Uint8ClampedArray(decoded2.data),
              width,
              height,
              { blendRatio }
            )
          }
        } catch {
          /* fallback to derived secondary terrain */
        }
      }
    }
    const secRgba = secondaryRgba ?? deriveSecondaryTerrainTileRgba(baseRgba, width, height)
    const wang16 = synthesizeWang16AutoTileAtlas(baseRgba, width, height, {
      secondaryRgba: secRgba,
      transitionRatio: blendRatio,
      edgeBevelStrength: 0.22,
      terrainName: ctx.node.title || 'terrain'
    })
    const godotTileSetTres = exportGodotTileSetTres(
      wang16,
      `res://tilesets/${(ctx.node.title || 'terrain').replace(/[^a-zA-Z0-9_-]/g, '_')}_wang16.png`
    )
    const [atlasUrl, primaryUrl, secondaryUrl] = await Promise.all([
      encodeRgbaWithCtx(ctx, wang16.data, wang16.atlasWidth, wang16.atlasHeight),
      encodeRgbaWithCtx(ctx, baseRgba, width, height),
      encodeRgbaWithCtx(ctx, secRgba, width, height)
    ])
    const rawBatch: GraphImageItem[] = [
      {
        id: `pbr:${ctx.node.id}:${stamp}:wang16`,
        title: 'Wang16_AutoTile_Atlas',
        dataUrl: atlasUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:primary`,
        title: 'Primary_Seamless_Tile',
        dataUrl: primaryUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:secondary`,
        title: 'Secondary_Terrain_Tile',
        dataUrl: secondaryUrl,
        createdAt
      }
    ]
    const materialized = await materializeGeneratedBatch(
      ctx,
      rawBatch,
      `pbr:${ctx.node.id}:${stamp}`
    )
    const reportJson = JSON.stringify(
      {
        mode: 'autotile_wang16',
        summary: {
          atlasResolution: `${wang16.atlasWidth}x${wang16.atlasHeight}`,
          tileResolution: `${width}x${height}`,
          cellCount: wang16.cells.length,
          seamScoreAfter: seamAfter.score
        },
        autoTile: wang16.manifest,
        godotTileSetTres
      },
      null,
      2
    )
    const outputs = replaceNodeGeneratedImages(materialized, {
      gamePbrAssetMode: assetMode,
      gameTileSeamless: tileSeamless,
      gameTileBlendRatio: blendRatio,
      gamePbrReport: `Wang-16 AutoTile ${wang16.atlasWidth}x${wang16.atlasHeight} (16 cells @ ${width}x${height}) | Godot 4 TileSet.tres ready`
    })
    outputs['out-meta'] = { kind: 'text', text: reportJson }
    return outputs
  }

  if (assetMode === 'scene_prop') {
    const keyedInput = new Uint8ClampedArray(rawRgba)
    if (!hasNativeTransparentPixels(keyedInput, width, height)) {
      applyBorderFloodColorKey(keyedInput, width, height)
    }
    const shadowOpacity = Math.max(
      0,
      Math.min(0.95, Number(ctx.node.params.gamePropShadowOpacity ?? 0.42))
    )
    const footprintHeightRatio = Math.max(
      0.1,
      Math.min(0.55, Number(ctx.node.params.gamePropFootprintRatio ?? 0.25))
    )
    const propResult = processScenePropWithYSortAndShadow(keyedInput, width, height, {
      shadowOpacity,
      footprintHeightRatio,
      maxHullVertices
    })
    const [propShadowUrl, propKeyedUrl] = await Promise.all([
      encodeRgbaWithCtx(ctx, propResult.data, width, height),
      encodeRgbaWithCtx(ctx, keyedInput, width, height)
    ])
    const rawBatch: GraphImageItem[] = [
      {
        id: `pbr:${ctx.node.id}:${stamp}:prop_ysort`,
        title: 'Prop_YSort_Shadow',
        dataUrl: propShadowUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:prop_clean`,
        title: 'Prop_Clean_Keyed',
        dataUrl: propKeyedUrl,
        createdAt
      }
    ]
    const materialized = await materializeGeneratedBatch(
      ctx,
      rawBatch,
      `pbr:${ctx.node.id}:${stamp}`
    )
    const reportJson = JSON.stringify(
      {
        mode: 'scene_prop',
        summary: {
          resolution: `${width}x${height}`,
          ySortBaselineY: propResult.ySortBaselineY,
          ySortPivotNormalized: propResult.ySortPivotNormalized,
          footprintRect: propResult.footprintRect,
          footprintHullVertices: propResult.footprintHull.verticesPx.length
        },
        ySortBaselineY: propResult.ySortBaselineY,
        ySortPivotNormalized: propResult.ySortPivotNormalized,
        footprintRect: propResult.footprintRect,
        shadowEllipse: propResult.shadowEllipse,
        physics: {
          spriteName: ctx.node.title || 'scene_prop',
          hull: propResult.footprintHull
        }
      },
      null,
      2
    )
    const outputs = replaceNodeGeneratedImages(materialized, {
      gamePbrAssetMode: assetMode,
      gamePropShadowOpacity: shadowOpacity,
      gamePropFootprintRatio: footprintHeightRatio,
      gamePbrReport: `Scene Prop ${width}x${height} | Y-Sort Y=${propResult.ySortBaselineY}px | Footprint ${propResult.footprintRect.width}x${propResult.footprintRect.height} (${propResult.footprintHull.verticesPx.length}v)`
    })
    outputs['out-meta'] = { kind: 'text', text: reportJson }
    return outputs
  }

  if (assetMode === 'raw_nine_slice') {
    const stylePreset = normalizeUiStylePreset(ctx.node.params.gameUiStylePreset)
    const symmetricLock = ctx.node.params.gameUiSymmetricLock === true
    const stretchModeRaw = ctx.node.params.gameNineSliceStretchMode ?? 'stretch'
    const stretchMode: NineSliceStretchMode = stretchModeRaw === 'tile' ? 'tile' : 'stretch'
    const assetTitle = (ctx.node.title || 'ui_nine_slice_panel').trim() || 'ui_nine_slice_panel'

    const sliced = sliceNinePatchRegionsRgba(rawRgba, width, height, nineSlice.borders, {
      autoKeyBackground: true,
      symmetricLock,
      stretchMode
    })
    const activeNineSlice = {
      ...nineSlice,
      borders: sliced.borders,
      centerRect: sliced.centerRect
    }
    const manifest = buildNineSliceManifest(assetTitle, activeNineSlice)
    const godotNinePatchTscn = exportGodotNinePatchTscn(manifest, {
      stretchMode,
      targetWidth: sliced.previewWidth,
      targetHeight: sliced.previewHeight
    })
    const unityNineSliceSnippet = exportUnityNineSliceSnippet(manifest, { stretchMode })
    const webCssNineSliceSnippet = exportWebCssNineSliceSnippet(manifest, { stretchMode })

    const [cleanedUrl, explodedUrl, stretchedUrl, hollowUrl] = await Promise.all([
      encodeRgbaWithCtx(ctx, sliced.cleanedRgba, width, height),
      encodeRgbaWithCtx(ctx, sliced.explodedSheetRgba, sliced.explodedWidth, sliced.explodedHeight),
      encodeRgbaWithCtx(
        ctx,
        sliced.stretchedPreviewRgba,
        sliced.previewWidth,
        sliced.previewHeight
      ),
      encodeRgbaWithCtx(ctx, sliced.hollowFrameRgba, width, height)
    ])

    const rawBatch: GraphImageItem[] = [
      {
        id: `pbr:${ctx.node.id}:${stamp}:nine_cleaned`,
        title: 'NineSlice_Cleaned_Source',
        dataUrl: cleanedUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:nine_exploded`,
        title: 'NineSlice_Exploded_9Patches_Atlas',
        dataUrl: explodedUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:nine_stretched`,
        title: `NineSlice_Stretched_Dialog_${sliced.previewWidth}x${sliced.previewHeight}`,
        dataUrl: stretchedUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:nine_hollow`,
        title: 'NineSlice_Hollow_Border_Frame',
        dataUrl: hollowUrl,
        createdAt
      }
    ]

    const materialized = await materializeGeneratedBatch(
      ctx,
      rawBatch,
      `pbr:${ctx.node.id}:${stamp}`
    )
    const b = sliced.borders
    const reportJson = JSON.stringify(
      {
        mode: 'raw_nine_slice',
        summary: {
          sourceResolution: `${width}x${height}`,
          explodedResolution: `${sliced.explodedWidth}x${sliced.explodedHeight}`,
          previewResolution: `${sliced.previewWidth}x${sliced.previewHeight}`,
          stretchMode,
          symmetricLock,
          borders: b,
          centerRect: sliced.centerRect,
          patchDimensions: sliced.patchList.map((p) => ({
            name: p.name,
            x: p.x,
            y: p.y,
            width: p.width,
            height: p.height
          }))
        },
        nineSlice: manifest,
        godotNinePatchTscn,
        unityNineSliceSnippet,
        webCssNineSliceSnippet
      },
      null,
      2
    )
    const outputs = replaceNodeGeneratedImages(materialized, {
      gamePbrAssetMode: assetMode,
      gameUiStylePreset: stylePreset,
      gameUiSymmetricLock: symmetricLock,
      gameNineSliceStretchMode: stretchMode,
      gamePbrReport: `Raw 9-Slice Direct (${width}x${height}) | Borders [L:${b.left} R:${b.right} T:${b.top} B:${b.bottom}] (${stretchMode}) | 9 Patches + Hollow Frame + Godot/Unity/CSS`
    })
    await populateUiContainerComponentPorts(outputs, stylePreset)
    outputs['out-meta'] = { kind: 'text', text: reportJson }
    return outputs
  }

  if (assetMode === 'ui_kit') {
    const stylePreset = normalizeUiStylePreset(ctx.node.params.gameUiStylePreset)
    const symmetricLock = ctx.node.params.gameUiSymmetricLock !== false
    const rarityRaw = ctx.node.params.gameIconRarityTier ?? 'legendary'
    const rarityTier: IconRarityTier =
      rarityRaw === 'common' ||
      rarityRaw === 'uncommon' ||
      rarityRaw === 'rare' ||
      rarityRaw === 'epic'
        ? rarityRaw
        : 'legendary'
    const stretchModeRaw = ctx.node.params.gameNineSliceStretchMode ?? 'stretch'
    const stretchMode: NineSliceStretchMode = stretchModeRaw === 'tile' ? 'tile' : 'stretch'
    const hasCustomBorders =
      ctx.node.params.gameNineSliceLeft != null ||
      ctx.node.params.gameNineSliceRight != null ||
      ctx.node.params.gameNineSliceTop != null ||
      ctx.node.params.gameNineSliceBottom != null
    const uiStates = generateUiButtonFourStates(rawRgba, width, height, {
      symmetricNineSlice: symmetricLock,
      stretchMode,
      ...(hasCustomBorders ? { customBorders } : {})
    })
    const rarityIcon = compositeIconWithRarityFrame(rawRgba, width, height, rarityTier)
    const godotThemeTres = exportGodotUiButtonThemeTres(uiStates.nineSlice.borders, stretchMode)

    const [
      sheetUrl,
      normalStateUrl,
      hoverStateUrl,
      pressedStateUrl,
      disabledStateUrl,
      focusedStateUrl,
      rarityUrl
    ] = await Promise.all([
      encodeRgbaWithCtx(ctx, uiStates.sheetData, uiStates.sheetWidth, uiStates.sheetHeight),
      encodeRgbaWithCtx(ctx, uiStates.states.normal, width, height),
      encodeRgbaWithCtx(ctx, uiStates.states.hover, width, height),
      encodeRgbaWithCtx(ctx, uiStates.states.pressed, width, height),
      encodeRgbaWithCtx(ctx, uiStates.states.disabled, width, height),
      encodeRgbaWithCtx(ctx, uiStates.states.focused, width, height),
      encodeRgbaWithCtx(ctx, rarityIcon.data, rarityIcon.width, rarityIcon.height)
    ])
    const rawBatch: GraphImageItem[] = [
      {
        id: `pbr:${ctx.node.id}:${stamp}:ui_sheet`,
        title: 'UI_Button_4States_Sheet',
        dataUrl: sheetUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:icon_rarity`,
        title: `Icon_Rarity_${rarityTier}`,
        dataUrl: rarityUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:ui_normal`,
        title: 'UI_Button_Normal',
        dataUrl: normalStateUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:ui_hover`,
        title: 'UI_Button_Hover',
        dataUrl: hoverStateUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:ui_pressed`,
        title: 'UI_Button_Pressed',
        dataUrl: pressedStateUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:ui_disabled`,
        title: 'UI_Button_Disabled',
        dataUrl: disabledStateUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:ui_focused`,
        title: 'UI_Button_Focused',
        dataUrl: focusedStateUrl,
        createdAt
      }
    ]
    const materialized = await materializeGeneratedBatch(
      ctx,
      rawBatch,
      `pbr:${ctx.node.id}:${stamp}`
    )
    const ub = uiStates.nineSlice.borders
    const reportJson = JSON.stringify(
      {
        mode: 'ui_kit',
        summary: {
          buttonResolution: `${width}x${height}`,
          sheetResolution: `${uiStates.sheetWidth}x${uiStates.sheetHeight}`,
          symmetricNineSlice: symmetricLock,
          stretchMode,
          nineSlice: ub,
          rarityTier,
          stylePreset
        },
        nineSlice: buildNineSliceManifest(ctx.node.title || 'ui_button', uiStates.nineSlice),
        godotThemeTres
      },
      null,
      2
    )
    const outputs = replaceNodeGeneratedImages(materialized, {
      gamePbrAssetMode: assetMode,
      gameUiStylePreset: stylePreset,
      gameUiSymmetricLock: symmetricLock,
      gameNineSliceStretchMode: stretchMode,
      gameIconRarityTier: rarityTier,
      gamePbrReport: `UI 5-State Kit (${stylePreset}) ${width}x${height} | 9-Slice [T:${ub.top} B:${ub.bottom} L:${ub.left} R:${ub.right}] (${stretchMode}) | Rarity: ${rarityTier.toUpperCase()}`
    })
    await populateUiContainerComponentPorts(outputs, stylePreset, rarityTier)
    outputs['out-meta'] = { kind: 'text', text: reportJson }
    return outputs
  }

  if (assetMode === 'vfx_demult') {
    const vfxMode: VfxProductionMode = ctx.node.params.gameVfxMode ?? 'vfx_flipbook'
    const vfxPalette: VfxElementalPalette = ctx.node.params.gameVfxPalette ?? 'original'
    const frameCountRaw = Number(ctx.node.params.gameVfxFrameCount ?? 8)
    const frameCount = frameCountRaw <= 4 ? 4 : frameCountRaw >= 16 ? 16 : 8
    const fps = Math.max(4, Math.min(60, Math.round(Number(ctx.node.params.gameVfxFps ?? 14))))
    const bloomStrength = Math.max(
      0,
      Math.min(1.5, Number(ctx.node.params.gameVfxBloomStrength ?? 0.45))
    )
    const dissolveErosion = Math.max(
      0,
      Math.min(1.0, Number(ctx.node.params.gameVfxDissolveErosion ?? 0.35))
    )
    const edgeFeather = Math.max(
      0,
      Math.min(0.35, Number(ctx.node.params.gameVfxEdgeFeather ?? 0.12))
    )
    const turbulence = Math.max(0, Math.min(1.5, Number(ctx.node.params.gameVfxTurbulence ?? 0.65)))
    const sparkCount = Math.max(
      0,
      Math.min(120, Math.round(Number(ctx.node.params.gameVfxSparkCount ?? 36)))
    )
    const distortionStrength = Math.max(
      0,
      Math.min(1.5, Number(ctx.node.params.gameVfxDistortionStrength ?? 0.55))
    )
    const blackClip = Math.max(0, Math.min(0.45, Number(ctx.node.params.gameVfxBlackClip ?? 0.04)))
    const whitePoint = Math.max(
      blackClip + 0.1,
      Math.min(1, Number(ctx.node.params.gameVfxWhitePoint ?? 0.88))
    )
    const gamma = Math.max(0.25, Math.min(2.5, Number(ctx.node.params.gameVfxGamma ?? 0.85)))
    const colorBoost = Math.max(1, Math.min(2.2, Number(ctx.node.params.gameVfxColorBoost ?? 1.15)))

    const pipeline = synthesizeVfxFlipbookPipeline(rawRgba, width, height, {
      frameCount,
      fps,
      palette: vfxPalette,
      bloomStrength,
      dissolveErosion,
      edgeFeather,
      turbulence,
      sparkCount,
      distortionStrength,
      blackClip,
      whitePoint,
      gamma,
      colorBoost,
      resourceName: (ctx.node.title || 'vfx_effect').replace(/[^a-zA-Z0-9_-]/g, '_')
    })

    const [
      flipbookUrl,
      vfxAlphaUrl,
      channelMaskUrl,
      distortionNormalUrl,
      flowVectorsUrl,
      scorchDecalUrl,
      ribbonUrl,
      rawSourceUrl
    ] = await Promise.all([
      encodeRgbaWithCtx(ctx, pipeline.sheetRgba, pipeline.sheetWidth, pipeline.sheetHeight),
      encodeRgbaWithCtx(ctx, pipeline.peakFrameRgba, width, height),
      encodeRgbaWithCtx(ctx, pipeline.channelPackedRgba, width, height),
      encodeRgbaWithCtx(ctx, pipeline.distortionNormalRgba, width, height),
      encodeRgbaWithCtx(ctx, pipeline.flowMotionVectorsRgba, width, height),
      encodeRgbaWithCtx(ctx, pipeline.scorchDecalRgba, width, height),
      encodeRgbaWithCtx(ctx, pipeline.ribbonTrailRgba, width, height),
      encodeRgbaWithCtx(ctx, rawRgba, width, height)
    ])

    let rawBatch: GraphImageItem[]
    if (vfxMode === 'vfx_trail_ribbon') {
      rawBatch = [
        {
          id: `pbr:${ctx.node.id}:${stamp}:vfx_ribbon`,
          title: 'VFX_Ribbon_Trail_Strip',
          dataUrl: ribbonUrl,
          createdAt
        },
        {
          id: `pbr:${ctx.node.id}:${stamp}:vfx_alpha`,
          title: 'VFX_Unpremultiplied_Alpha',
          dataUrl: vfxAlphaUrl,
          createdAt
        },
        {
          id: `pbr:${ctx.node.id}:${stamp}:vfx_distortion`,
          title: 'VFX_Distortion_Normal',
          dataUrl: distortionNormalUrl,
          createdAt
        },
        {
          id: `pbr:${ctx.node.id}:${stamp}:vfx_flow`,
          title: 'VFX_Flow_Motion_Vectors',
          dataUrl: flowVectorsUrl,
          createdAt
        },
        {
          id: `pbr:${ctx.node.id}:${stamp}:vfx_mask`,
          title: 'VFX_Channel_Packed_Mask',
          dataUrl: channelMaskUrl,
          createdAt
        }
      ]
    } else if (vfxMode === 'vfx_channel_pack') {
      rawBatch = [
        {
          id: `pbr:${ctx.node.id}:${stamp}:vfx_mask`,
          title: 'VFX_Channel_Packed_Mask',
          dataUrl: channelMaskUrl,
          createdAt
        },
        {
          id: `pbr:${ctx.node.id}:${stamp}:vfx_flow`,
          title: 'VFX_Flow_Motion_Vectors',
          dataUrl: flowVectorsUrl,
          createdAt
        },
        {
          id: `pbr:${ctx.node.id}:${stamp}:vfx_distortion`,
          title: 'VFX_Distortion_Normal',
          dataUrl: distortionNormalUrl,
          createdAt
        },
        {
          id: `pbr:${ctx.node.id}:${stamp}:vfx_alpha`,
          title: 'VFX_Unpremultiplied_Alpha',
          dataUrl: vfxAlphaUrl,
          createdAt
        },
        {
          id: `pbr:${ctx.node.id}:${stamp}:vfx_flipbook`,
          title: `VFX_Flipbook_${pipeline.cols}x${pipeline.rows}`,
          dataUrl: flipbookUrl,
          createdAt
        }
      ]
    } else if (vfxMode === 'vfx_demult') {
      rawBatch = [
        {
          id: `pbr:${ctx.node.id}:${stamp}:vfx_alpha`,
          title: 'VFX_Unpremultiplied_Alpha',
          dataUrl: vfxAlphaUrl,
          createdAt
        },
        {
          id: `pbr:${ctx.node.id}:${stamp}:vfx_distortion`,
          title: 'VFX_Distortion_Normal',
          dataUrl: distortionNormalUrl,
          createdAt
        },
        {
          id: `pbr:${ctx.node.id}:${stamp}:vfx_decal`,
          title: 'VFX_Scorch_Decal',
          dataUrl: scorchDecalUrl,
          createdAt
        },
        {
          id: `pbr:${ctx.node.id}:${stamp}:vfx_mask`,
          title: 'VFX_Channel_Packed_Mask',
          dataUrl: channelMaskUrl,
          createdAt
        },
        {
          id: `pbr:${ctx.node.id}:${stamp}:vfx_source`,
          title: 'VFX_Raw_Source',
          dataUrl: rawSourceUrl,
          createdAt
        }
      ]
    } else {
      // Default: 'vfx_flipbook' — Full lifecycle sprite sheet + hero frame + flow vectors + distortion normal + scorch decal + channel mask + ribbon + raw source
      rawBatch = [
        {
          id: `pbr:${ctx.node.id}:${stamp}:vfx_flipbook`,
          title: `VFX_Flipbook_${pipeline.cols}x${pipeline.rows}`,
          dataUrl: flipbookUrl,
          createdAt
        },
        {
          id: `pbr:${ctx.node.id}:${stamp}:vfx_alpha`,
          title: 'VFX_Unpremultiplied_Alpha',
          dataUrl: vfxAlphaUrl,
          createdAt
        },
        {
          id: `pbr:${ctx.node.id}:${stamp}:vfx_flow`,
          title: 'VFX_Flow_Motion_Vectors',
          dataUrl: flowVectorsUrl,
          createdAt
        },
        {
          id: `pbr:${ctx.node.id}:${stamp}:vfx_distortion`,
          title: 'VFX_Distortion_Normal',
          dataUrl: distortionNormalUrl,
          createdAt
        },
        {
          id: `pbr:${ctx.node.id}:${stamp}:vfx_decal`,
          title: 'VFX_Scorch_Decal',
          dataUrl: scorchDecalUrl,
          createdAt
        },
        {
          id: `pbr:${ctx.node.id}:${stamp}:vfx_mask`,
          title: 'VFX_Channel_Packed_Mask',
          dataUrl: channelMaskUrl,
          createdAt
        },
        {
          id: `pbr:${ctx.node.id}:${stamp}:vfx_ribbon`,
          title: 'VFX_Ribbon_Trail_Strip',
          dataUrl: ribbonUrl,
          createdAt
        },
        {
          id: `pbr:${ctx.node.id}:${stamp}:vfx_source`,
          title: 'VFX_Raw_Source',
          dataUrl: rawSourceUrl,
          createdAt
        }
      ]
    }

    const materialized = await materializeGeneratedBatch(
      ctx,
      rawBatch,
      `pbr:${ctx.node.id}:${stamp}`
    )
    const reportJson = JSON.stringify(
      {
        mode: 'vfx_demult',
        vfxMode,
        summary: {
          resolution: `${width}x${height}`,
          sheetResolution: `${pipeline.sheetWidth}x${pipeline.sheetHeight}`,
          frameCount: pipeline.frameCount,
          grid: `${pipeline.cols}x${pipeline.rows}`,
          fps: pipeline.fps,
          palette: vfxPalette,
          transparentRatio: pipeline.transparentRatio,
          peakAlpha: pipeline.peakAlpha,
          bloomStrength,
          dissolveErosion,
          edgeFeather,
          turbulence,
          sparkCount,
          distortionStrength,
          blackClip,
          whitePoint,
          gamma,
          colorBoost
        },
        godotSpriteFramesTres: pipeline.godotSpriteFramesTres,
        godotVfxShader: pipeline.godotVfxShader,
        godotVfxPrefabTscn: pipeline.godotVfxPrefabTscn,
        unityParticleJson: JSON.parse(pipeline.unityParticleJson)
      },
      null,
      2
    )
    const outputs = replaceNodeGeneratedImages(materialized, {
      gamePbrAssetMode: assetMode,
      gameVfxMode: vfxMode,
      gameVfxPalette: vfxPalette,
      gameVfxFrameCount: frameCount,
      gameVfxFps: fps,
      gameVfxBloomStrength: bloomStrength,
      gameVfxDissolveErosion: dissolveErosion,
      gameVfxEdgeFeather: edgeFeather,
      gameVfxTurbulence: turbulence,
      gameVfxSparkCount: sparkCount,
      gameVfxDistortionStrength: distortionStrength,
      gameVfxBlackClip: blackClip,
      gameVfxWhitePoint: whitePoint,
      gameVfxGamma: gamma,
      gameVfxColorBoost: colorBoost,
      gamePbrReport: `2D VFX (${vfxMode}) ${pipeline.cols}x${pipeline.rows} (${pipeline.sheetWidth}x${pipeline.sheetHeight}, ${frameCount}f @ ${fps}fps) | Curl ${Math.round(turbulence * 100)}% | Sparks ${sparkCount}`
    })
    outputs['out-meta'] = { kind: 'text', text: reportJson }
    return outputs
  }

  if (assetMode === 'ui_full_suite') {
    const stylePreset = normalizeUiStylePreset(ctx.node.params.gameUiStylePreset)
    const rarityRaw = ctx.node.params.gameIconRarityTier ?? 'legendary'
    const rarityTier: IconRarityTier =
      rarityRaw === 'common' ||
      rarityRaw === 'uncommon' ||
      rarityRaw === 'rare' ||
      rarityRaw === 'epic'
        ? rarityRaw
        : 'legendary'
    const suiteTitle = (ctx.node.title || 'CELESTIAL_UI_SUITE').trim()
    const secondarySources = await decodeSecondarySources()

    let effectiveArtboardJson = ctx.node.params.gameUiArtboardJson?.trim() || ''
    if (effectiveArtboardJson) {
      try {
        const parsed = JSON.parse(effectiveArtboardJson)
        if (parsed?.stylePreset !== stylePreset) {
          effectiveArtboardJson = ''
        }
      } catch {
        effectiveArtboardJson = ''
      }
    }
    if (!effectiveArtboardJson) {
      effectiveArtboardJson = buildThemedArtboardSuitePayload(stylePreset, suiteTitle).jsonString
    }

    const screenResults = await Promise.all(
      FULL_UI_SUITE_BLUEPRINTS.map(async (bp, idx) => {
        const rendered = synthesizeFullScreenUiArtboardRgba(rawRgba, width, height, {
          blueprint: bp,
          stylePreset,
          artboardJson: effectiveArtboardJson,
          resourceName: `${suiteTitle.replace(/[^a-zA-Z0-9_-]/g, '_')}_${bp}`,
          secondarySources
        })
        const dataUrl = await encodeRgbaWithCtx(ctx, rendered.data, rendered.width, rendered.height)
        return {
          blueprint: bp,
          index: idx + 1,
          layerCount: rendered.layerCount,
          godotFullScreenTscn: rendered.godotFullScreenTscn,
          item: {
            id: `pbr:${ctx.node.id}:${stamp}:suite_${bp}`,
            title: `UI_${idx + 1}_${bp.toUpperCase()}`,
            dataUrl,
            createdAt
          } satisfies GraphImageItem
        }
      })
    )

    const gachaSrc = secondarySources[0] ?? { width, height, data: rawRgba }
    const relicSrc = secondarySources[1] ?? secondarySources[0] ?? { width, height, data: rawRgba }
    const safeTitle = suiteTitle.replace(/[^a-zA-Z0-9_-]/g, '_')

    const medallionOut = composeLayeredFrameTemplate(rawRgba, width, height, {
      frameShape: 'octagonal_medallion',
      rarity: rarityTier,
      stylePreset,
      foilStrength: 0.78,
      resourceName: `${safeTitle}_avatar_medallion`
    })
    const cardFrameOut = composeLayeredFrameTemplate(
      gachaSrc.data,
      gachaSrc.width,
      gachaSrc.height,
      {
        frameShape: 'rect_card',
        rarity: rarityTier,
        stylePreset,
        foilStrength: 0.78,
        resourceName: `${safeTitle}_card`
      }
    )
    const slotFrameOut = composeLayeredFrameTemplate(
      relicSrc.data,
      relicSrc.width,
      relicSrc.height,
      {
        frameShape: 'square_slot',
        rarity: rarityTier,
        stylePreset,
        foilStrength: 0.72,
        resourceName: `${safeTitle}_item_slot`
      }
    )
    const hudKit = synthesizeHudProgressBarKit(rawRgba, Math.max(width, 256), 64, {
      preset: 'hp_crimson',
      stylePreset,
      resourceName: `${safeTitle}_hud_bar`
    })
    const hudShowcase = synthesizeUiAssetKitShowcaseRgba(
      'hud_bar_kit',
      rawRgba,
      width,
      height,
      stylePreset
    )
    const radialShowcase = synthesizeUiAssetKitShowcaseRgba(
      'radial_hud_kit',
      relicSrc.data,
      relicSrc.width,
      relicSrc.height,
      stylePreset
    )
    const dialogueShowcase = synthesizeUiAssetKitShowcaseRgba(
      'dialogue_kit',
      rawRgba,
      width,
      height,
      stylePreset
    )

    const [medallionUrl, cardFrameUrl, slotFrameUrl, hudKitUrl, radialKitUrl, dialogueKitUrl] =
      await Promise.all([
        encodeRgbaWithCtx(ctx, medallionOut.compositeRgba, medallionOut.width, medallionOut.height),
        encodeRgbaWithCtx(ctx, cardFrameOut.compositeRgba, cardFrameOut.width, cardFrameOut.height),
        encodeRgbaWithCtx(ctx, slotFrameOut.compositeRgba, slotFrameOut.width, slotFrameOut.height),
        encodeRgbaWithCtx(ctx, hudShowcase.data, hudShowcase.width, hudShowcase.height),
        encodeRgbaWithCtx(ctx, radialShowcase.data, radialShowcase.width, radialShowcase.height),
        encodeRgbaWithCtx(
          ctx,
          dialogueShowcase.data,
          dialogueShowcase.width,
          dialogueShowcase.height
        )
      ])

    const rawBatch: GraphImageItem[] = [
      ...screenResults.map((s) => s.item),
      {
        id: `pbr:${ctx.node.id}:${stamp}:suite_avatar_medallion`,
        title: 'UI_9_Avatar_Medallion',
        dataUrl: medallionUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:suite_card_frame`,
        title: 'UI_10_SSR_Card_Frame',
        dataUrl: cardFrameUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:suite_item_slot`,
        title: 'UI_11_Artifact_Item_Slot',
        dataUrl: slotFrameUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:suite_hud_bar`,
        title: 'UI_12_HUD_Progress_Bar_Kit',
        dataUrl: hudKitUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:suite_radial_hud`,
        title: 'UI_13_Radial_Minimap_And_Skill_Ring',
        dataUrl: radialKitUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:suite_dialogue_kit`,
        title: 'UI_14_Dialogue_Box_And_Button_Kit',
        dataUrl: dialogueKitUrl,
        createdAt
      }
    ]

    const materialized = await materializeGeneratedBatch(
      ctx,
      rawBatch,
      `pbr:${ctx.node.id}:${stamp}`
    )
    const tscnScenes: Record<string, string> = {}
    for (const sr of screenResults) {
      tscnScenes[sr.blueprint] = sr.godotFullScreenTscn
    }
    const reportJson = JSON.stringify(
      {
        mode: 'ui_full_suite',
        summary: {
          suiteTitle,
          stylePreset,
          rarity: rarityTier,
          screenCount: screenResults.length,
          assetKitCount: 6,
          upstreamImageCount: sourceItems.length,
          screens: screenResults.map((s) => ({
            blueprint: s.blueprint,
            layerCount: s.layerCount
          }))
        },
        godotFullScreenScenesTscn: tscnScenes,
        godotMedallionControlTres: medallionOut.godotControlTres,
        godotCardControlTres: cardFrameOut.godotControlTres,
        godotSlotControlTres: slotFrameOut.godotControlTres,
        godotHudProgressBarTscn: hudKit.godotProgressBarTscn
      },
      null,
      2
    )
    const outputs = replaceNodeGeneratedImages(materialized, {
      gamePbrAssetMode: assetMode,
      gameUiStylePreset: stylePreset,
      gameIconRarityTier: rarityTier,
      gameUiArtboardJson: effectiveArtboardJson,
      gameUiArtboardPreviewDataUrl: undefined,
      gamePbrReport: `Full 8-Screen UI Suite (${stylePreset}) | 8 Screens + 6 UI Asset Kits (Medallion/Card/Slot/HUD/Radial/Dialogue) + Godot .tscn`
    })
    const toImageValue = (item: GraphImageItem | undefined) =>
      item
        ? {
            kind: 'image' as const,
            id: item.id,
            title: item.title,
            dataUrl: item.dataUrl,
            createdAt: item.createdAt,
            ...(item.relativePath ? { relativePath: item.relativePath } : {})
          }
        : undefined
    const medVal = toImageValue(materialized[8])
    const cardVal = toImageValue(materialized[9])
    const slotVal = toImageValue(materialized[10])
    const hudVal = toImageValue(materialized[11])
    const radVal = toImageValue(materialized[12])
    const dlgVal = toImageValue(materialized[13])
    if (medVal) outputs['out-medallion'] = medVal
    if (cardVal) outputs['out-card'] = cardVal
    if (slotVal) outputs['out-slot'] = slotVal
    if (hudVal) outputs['out-hud-bar'] = hudVal
    if (radVal) outputs['out-radial'] = radVal
    if (dlgVal) outputs['out-dialogue'] = dlgVal
    outputs['out-meta'] = { kind: 'text', text: reportJson }
    return outputs
  }

  if (assetMode === 'composite_frame') {
    const shapeRaw = ctx.node.params.gameFrameShape ?? 'rect_card'
    const frameShape: UniversalFrameShape =
      shapeRaw === 'square_slot' ||
      shapeRaw === 'octagonal_medallion' ||
      shapeRaw === 'banner_plaque'
        ? shapeRaw
        : 'rect_card'
    const rarityRaw = ctx.node.params.gameIconRarityTier ?? 'rare'
    const rarityTier: IconRarityTier =
      rarityRaw === 'common' ||
      rarityRaw === 'uncommon' ||
      rarityRaw === 'rare' ||
      rarityRaw === 'epic'
        ? rarityRaw
        : 'legendary'
    const stylePreset = normalizeUiStylePreset(ctx.node.params.gameUiStylePreset)
    const foilStrength = Math.max(
      0,
      Math.min(1, Number(ctx.node.params.gameUiFoilStrength ?? 0.65))
    )

    const secondarySources = await decodeSecondarySources()
    const frameOut = composeLayeredFrameTemplate(rawRgba, width, height, {
      frameShape,
      rarity: rarityTier,
      stylePreset,
      foilStrength,
      resourceName: (ctx.node.title || 'layered_frame').replace(/[^a-zA-Z0-9_-]/g, '_')
    })
    const blueprintPreset = (ctx.node.params.gameUiScreenBlueprint ??
      'combat_hud') as UiScreenBlueprintPreset
    const artboardOut = synthesizeFullScreenUiArtboardRgba(rawRgba, width, height, {
      blueprint: blueprintPreset,
      stylePreset,
      artboardJson: ctx.node.params.gameUiArtboardJson,
      resourceName: (ctx.node.title || 'game_ui_screen').replace(/[^a-zA-Z0-9_-]/g, '_'),
      secondarySources
    })
    const [artboardScreenUrl, compositeUrl, maskedArtUrl, borderUrl, foilMaskUrl] =
      await Promise.all([
        encodeRgbaWithCtx(ctx, artboardOut.data, artboardOut.width, artboardOut.height),
        encodeRgbaWithCtx(ctx, frameOut.compositeRgba, width, height),
        encodeRgbaWithCtx(ctx, frameOut.maskedArtRgba, width, height),
        encodeRgbaWithCtx(ctx, frameOut.frameBorderRgba, width, height),
        encodeRgbaWithCtx(ctx, frameOut.foilShimmerMaskRgba, width, height)
      ])
    const rawBatch: GraphImageItem[] = [
      {
        id: `pbr:${ctx.node.id}:${stamp}:frame_composite`,
        title: `Composite_${frameShape}`,
        dataUrl: compositeUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:frame_layer1_art`,
        title: 'Layer_1_Masked_Art',
        dataUrl: maskedArtUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:frame_layer2_border`,
        title: 'Layer_2_Frame_Border',
        dataUrl: borderUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:frame_layer4_foil`,
        title: 'Layer_4_Foil_Shimmer_Mask',
        dataUrl: foilMaskUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:ui_artboard_screen`,
        title: `UI_Screen_Artboard_${blueprintPreset}`,
        dataUrl: artboardScreenUrl,
        createdAt
      }
    ]
    const materialized = await materializeGeneratedBatch(
      ctx,
      rawBatch,
      `pbr:${ctx.node.id}:${stamp}`
    )
    const reportJson = JSON.stringify(
      {
        mode: 'composite_frame',
        summary: {
          resolution: `${width}x${height}`,
          frameShape,
          rarity: rarityTier,
          stylePreset,
          foilStrength,
          artboardBlueprint: blueprintPreset,
          artboardLayerCount: artboardOut.layerCount,
          upstreamImageCount: sourceItems.length
        },
        layoutRects: frameOut.layoutRects,
        godotControlTres: frameOut.godotControlTres,
        godotFoilShader: frameOut.godotFoilShader,
        godotFullScreenTscn: artboardOut.godotFullScreenTscn
      },
      null,
      2
    )
    const outputs = replaceNodeGeneratedImages(materialized, {
      gamePbrAssetMode: assetMode,
      gameFrameShape: frameShape,
      gameIconRarityTier: rarityTier,
      gameUiStylePreset: stylePreset,
      gameUiFoilStrength: foilStrength,
      gameUiArtboardPreviewDataUrl: undefined,
      gamePbrReport: `UI Studio (${blueprintPreset} · ${artboardOut.layerCount} layers · ${stylePreset}) | Artboard + 4 Sliced Layers + Godot .tscn/.tres`
    })
    await populateUiContainerComponentPorts(outputs, stylePreset, rarityTier)
    outputs['out-meta'] = { kind: 'text', text: reportJson }
    return outputs
  }

  if (assetMode === 'hud_bar_kit') {
    const hudPresetRaw = ctx.node.params.gameHudBarPreset ?? 'hp_crimson'
    const hudPreset: HudBarColorPreset =
      hudPresetRaw === 'shield_cyan' ||
      hudPresetRaw === 'mana_violet' ||
      hudPresetRaw === 'xp_gold' ||
      hudPresetRaw === 'boss_inferno'
        ? hudPresetRaw
        : 'hp_crimson'
    const stylePreset = normalizeUiStylePreset(ctx.node.params.gameUiStylePreset)

    const hudBarW = Math.max(width, 256)
    const hudBarH = 64
    const hudKit = synthesizeHudProgressBarKit(rawRgba, hudBarW, hudBarH, {
      preset: hudPreset,
      stylePreset,
      resourceName: (ctx.node.title || 'hud_progress_bar').replace(/[^a-zA-Z0-9_-]/g, '_')
    })
    const [compositeUrl, backplateUrl, fillStripUrl, frameOverlayUrl] = await Promise.all([
      encodeRgbaWithCtx(ctx, hudKit.compositePreviewRgba, hudKit.width, hudKit.height),
      encodeRgbaWithCtx(ctx, hudKit.backplateRgba, hudKit.width, hudKit.height),
      encodeRgbaWithCtx(ctx, hudKit.fillStripRgba, hudKit.width, hudKit.height),
      encodeRgbaWithCtx(ctx, hudKit.frameOverlayRgba, hudKit.width, hudKit.height)
    ])
    const rawBatch: GraphImageItem[] = [
      {
        id: `pbr:${ctx.node.id}:${stamp}:hud_composite`,
        title: `HUD_Bar_Composite_${hudPreset}`,
        dataUrl: compositeUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:hud_backplate`,
        title: 'HUD_Bar_Backplate',
        dataUrl: backplateUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:hud_fill`,
        title: 'HUD_Bar_Fill_Strip',
        dataUrl: fillStripUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:hud_frame`,
        title: 'HUD_Bar_Frame_Overlay',
        dataUrl: frameOverlayUrl,
        createdAt
      }
    ]
    const materialized = await materializeGeneratedBatch(
      ctx,
      rawBatch,
      `pbr:${ctx.node.id}:${stamp}`
    )
    const reportJson = JSON.stringify(
      {
        mode: 'hud_bar_kit',
        summary: {
          resolution: `${hudKit.width}x${hudKit.height}`,
          preset: hudPreset,
          stylePreset,
          nineSliceBorders: hudKit.nineSliceBorders
        },
        godotProgressBarTscn: hudKit.godotProgressBarTscn
      },
      null,
      2
    )
    const outputs = replaceNodeGeneratedImages(materialized, {
      gamePbrAssetMode: assetMode,
      gameHudBarPreset: hudPreset,
      gameUiStylePreset: stylePreset,
      gamePbrReport: `HUD Bar Kit (${hudPreset} · ${stylePreset}) ${hudKit.width}x${hudKit.height} | 3 Layers (Backplate / Fill / Frame) + Godot TextureProgressBar`
    })
    await populateUiContainerComponentPorts(outputs, stylePreset)
    outputs['out-meta'] = { kind: 'text', text: reportJson }
    return outputs
  }

  if (assetMode === 'radial_hud_kit') {
    const stylePreset = normalizeUiStylePreset(ctx.node.params.gameUiStylePreset)

    const radialKit = synthesizeRadialHudKit(rawRgba, width, height, {
      stylePreset,
      resourceName: (ctx.node.title || 'radial_hud').replace(/[^a-zA-Z0-9_-]/g, '_')
    })
    const [minimapUrl, skillSlotUrl, cooldownMaskUrl, actionWheelUrl] = await Promise.all([
      encodeRgbaWithCtx(ctx, radialKit.minimapCompassRgba, radialKit.width, radialKit.height),
      encodeRgbaWithCtx(ctx, radialKit.skillSlotFrameRgba, radialKit.width, radialKit.height),
      encodeRgbaWithCtx(ctx, radialKit.cooldownWipeMaskRgba, radialKit.width, radialKit.height),
      encodeRgbaWithCtx(ctx, radialKit.actionWheelRgba, radialKit.width, radialKit.height)
    ])
    const rawBatch: GraphImageItem[] = [
      {
        id: `pbr:${ctx.node.id}:${stamp}:radial_minimap`,
        title: 'Radial_Minimap_Compass_Ring',
        dataUrl: minimapUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:radial_skill`,
        title: 'Radial_Skill_Slot_Frame',
        dataUrl: skillSlotUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:radial_cd`,
        title: 'Radial_Cooldown_Wipe_Mask',
        dataUrl: cooldownMaskUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:radial_wheel`,
        title: 'Radial_Action_Wheel_8Sector',
        dataUrl: actionWheelUrl,
        createdAt
      }
    ]
    const materialized = await materializeGeneratedBatch(
      ctx,
      rawBatch,
      `pbr:${ctx.node.id}:${stamp}`
    )
    const reportJson = JSON.stringify(
      {
        mode: 'radial_hud_kit',
        summary: {
          resolution: `${radialKit.width}x${radialKit.height}`,
          stylePreset
        },
        godotRadialHudTscn: radialKit.godotRadialHudTscn
      },
      null,
      2
    )
    const outputs = replaceNodeGeneratedImages(materialized, {
      gamePbrAssetMode: assetMode,
      gameUiStylePreset: stylePreset,
      gamePbrReport: `Radial Polar HUD Kit (${stylePreset}) ${radialKit.width}x${radialKit.height} | Minimap Ring + Skill Slot + 360° Cooldown Wipe + 8-Way Wheel`
    })
    await populateUiContainerComponentPorts(outputs, stylePreset)
    outputs['out-meta'] = { kind: 'text', text: reportJson }
    return outputs
  }

  if (assetMode === 'dialogue_kit') {
    const stylePreset = normalizeUiStylePreset(ctx.node.params.gameUiStylePreset)

    const dlgKit = synthesizeDialogueBoxKit(rawRgba, width, height, {
      stylePreset,
      resourceName: (ctx.node.title || 'dialogue_kit').replace(/[^a-zA-Z0-9_-]/g, '_')
    })
    const [compUrl, mainBoxUrl, nameplateChoiceUrl, portraitCursorUrl] = await Promise.all([
      encodeRgbaWithCtx(ctx, dlgKit.compositePreviewRgba, dlgKit.width, dlgKit.height),
      encodeRgbaWithCtx(ctx, dlgKit.mainBoxRgba, dlgKit.width, dlgKit.height),
      encodeRgbaWithCtx(ctx, dlgKit.nameplateAndChoiceRgba, dlgKit.width, dlgKit.height),
      encodeRgbaWithCtx(ctx, dlgKit.portraitAndCursorRgba, dlgKit.width, dlgKit.height)
    ])
    const rawBatch: GraphImageItem[] = [
      {
        id: `pbr:${ctx.node.id}:${stamp}:dlg_comp`,
        title: 'Dialogue_Composite_Preview',
        dataUrl: compUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:dlg_box`,
        title: 'Dialogue_Main_Box_9Slice',
        dataUrl: mainBoxUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:dlg_name_choice`,
        title: 'Dialogue_Nameplate_And_Choice',
        dataUrl: nameplateChoiceUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:dlg_portrait`,
        title: 'Dialogue_Portrait_And_Cursor',
        dataUrl: portraitCursorUrl,
        createdAt
      }
    ]
    const materialized = await materializeGeneratedBatch(
      ctx,
      rawBatch,
      `pbr:${ctx.node.id}:${stamp}`
    )
    const reportJson = JSON.stringify(
      {
        mode: 'dialogue_kit',
        summary: {
          resolution: `${dlgKit.width}x${dlgKit.height}`,
          stylePreset,
          nineSliceBorders: dlgKit.nineSliceBorders
        },
        godotDialogueSceneTscn: dlgKit.godotDialogueSceneTscn
      },
      null,
      2
    )
    const outputs = replaceNodeGeneratedImages(materialized, {
      gamePbrAssetMode: assetMode,
      gameUiStylePreset: stylePreset,
      gamePbrReport: `RPG/AVG Dialogue Kit (${stylePreset}) ${dlgKit.width}x${dlgKit.height} | Main Box + Nameplate + Portrait Socket + Choice Pill`
    })
    await populateUiContainerComponentPorts(outputs, stylePreset)
    outputs['out-meta'] = { kind: 'text', text: reportJson }
    return outputs
  }

  if (assetMode === 'ui_controls_kit') {
    const stylePreset = normalizeUiStylePreset(ctx.node.params.gameUiStylePreset)

    const ctrlKit = synthesizeUiFormControlsKit(rawRgba, width, height, {
      stylePreset,
      resourceName: (ctx.node.title || 'ui_controls').replace(/[^a-zA-Z0-9_-]/g, '_')
    })
    const [atlasUrl, tabsUrl, sliderUrl, checkboxUrl] = await Promise.all([
      encodeRgbaWithCtx(ctx, ctrlKit.atlasSheetRgba, ctrlKit.width, ctrlKit.height),
      encodeRgbaWithCtx(ctx, ctrlKit.tabsPairRgba, ctrlKit.width, ctrlKit.height),
      encodeRgbaWithCtx(ctx, ctrlKit.sliderAndScrollRgba, ctrlKit.width, ctrlKit.height),
      encodeRgbaWithCtx(ctx, ctrlKit.checkboxAndToggleRgba, ctrlKit.width, ctrlKit.height)
    ])
    const rawBatch: GraphImageItem[] = [
      {
        id: `pbr:${ctx.node.id}:${stamp}:ctrl_atlas`,
        title: 'UI_Controls_Atlas_Sheet',
        dataUrl: atlasUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:ctrl_tabs`,
        title: 'UI_Tab_Active_Inactive',
        dataUrl: tabsUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:ctrl_slider`,
        title: 'UI_Slider_And_Scrollbar',
        dataUrl: sliderUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:ctrl_checkbox`,
        title: 'UI_Checkbox_And_Toggle',
        dataUrl: checkboxUrl,
        createdAt
      }
    ]
    const materialized = await materializeGeneratedBatch(
      ctx,
      rawBatch,
      `pbr:${ctx.node.id}:${stamp}`
    )
    const reportJson = JSON.stringify(
      {
        mode: 'ui_controls_kit',
        summary: {
          resolution: `${ctrlKit.width}x${ctrlKit.height}`,
          stylePreset
        },
        godotFullControlsThemeTres: ctrlKit.godotFullControlsThemeTres
      },
      null,
      2
    )
    const outputs = replaceNodeGeneratedImages(materialized, {
      gamePbrAssetMode: assetMode,
      gameUiStylePreset: stylePreset,
      gamePbrReport: `UI Form Controls Kit (${stylePreset}) ${ctrlKit.width}x${ctrlKit.height} | Tabs + Slider + Checkbox + Toggle + Godot Theme.tres`
    })
    await populateUiContainerComponentPorts(outputs, stylePreset)
    outputs['out-meta'] = { kind: 'text', text: reportJson }
    return outputs
  }

  if (assetMode === 'sprite_stroke_mip') {
    const strokeWidthPx = Math.max(
      1,
      Math.min(10, Math.round(Number(ctx.node.params.gameStrokeWidthPx ?? 3)))
    )
    const colorPresetRaw = ctx.node.params.gameStrokeColorPreset ?? 'gold'
    const strokeColorPreset: SpriteStrokeColorPreset =
      colorPresetRaw === 'white' ||
      colorPresetRaw === 'black' ||
      colorPresetRaw === 'cyan' ||
      colorPresetRaw === 'crimson'
        ? colorPresetRaw
        : 'gold'
    const shadowOpacity = Math.max(
      0,
      Math.min(0.85, Number(ctx.node.params.gamePropShadowOpacity ?? 0.35))
    )
    const mipOut = processSpriteStrokeAndMipChain(rawRgba, width, height, {
      strokeWidthPx,
      strokeColorPreset,
      shadowOpacity,
      autoKey: true
    })
    const [strokedUrl, mip128Url, mip64Url, mip32Url] = await Promise.all([
      encodeRgbaWithCtx(ctx, mipOut.strokedRgba, width, height),
      encodeRgbaWithCtx(ctx, mipOut.mip128.rgba, mipOut.mip128.width, mipOut.mip128.height),
      encodeRgbaWithCtx(ctx, mipOut.mip64.rgba, mipOut.mip64.width, mipOut.mip64.height),
      encodeRgbaWithCtx(ctx, mipOut.mip32.rgba, mipOut.mip32.width, mipOut.mip32.height)
    ])
    const rawBatch: GraphImageItem[] = [
      {
        id: `pbr:${ctx.node.id}:${stamp}:stroke_full`,
        title: `Sprite_Stroked_${width}x${height}`,
        dataUrl: strokedUrl,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:mip_128`,
        title: 'Sprite_Mip_128x128',
        dataUrl: mip128Url,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:mip_64`,
        title: 'Sprite_Mip_64x64',
        dataUrl: mip64Url,
        createdAt
      },
      {
        id: `pbr:${ctx.node.id}:${stamp}:mip_32`,
        title: 'Sprite_Mip_32x32',
        dataUrl: mip32Url,
        createdAt
      }
    ]
    const materialized = await materializeGeneratedBatch(
      ctx,
      rawBatch,
      `pbr:${ctx.node.id}:${stamp}`
    )
    const reportJson = JSON.stringify(
      {
        mode: 'sprite_stroke_mip',
        summary: {
          resolution: `${width}x${height}`,
          strokeWidthPx,
          strokeColorPreset,
          shadowOpacity,
          mips: ['128x128', '64x64', '32x32']
        },
        physics: physicsManifest
      },
      null,
      2
    )
    const outputs = replaceNodeGeneratedImages(materialized, {
      gamePbrAssetMode: assetMode,
      gameStrokeWidthPx: strokeWidthPx,
      gameStrokeColorPreset: strokeColorPreset,
      gamePropShadowOpacity: shadowOpacity,
      gamePbrReport: `Sprite Stroke (${strokeWidthPx}px ${strokeColorPreset}) + Sharpened Mips (128/64/32)`
    })
    outputs['out-meta'] = { kind: 'text', text: reportJson }
    return outputs
  }

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
  const autoTileManifest = buildAutoTileAtlasManifest({
    terrainName: ctx.node.title || 'terrain',
    layout: 'wang16',
    tileWidth: width,
    tileHeight: height
  })
  const bitmapFontManifest = buildBitmapFontManifest({
    fontName: ctx.node.title || 'DamageFont',
    atlasWidth: width,
    atlasHeight: height
  })
  const reportJson = JSON.stringify(
    {
      summary: reportObj,
      nineSlice: nineSliceManifest,
      physics: physicsManifest,
      autoTile: autoTileManifest,
      bitmapFont: bitmapFontManifest
    },
    null,
    2
  )

  const outputs = replaceNodeGeneratedImages(materialized, {
    gameTileSeamless: tileSeamless,
    gameTileBlendRatio: blendRatio,
    gamePbrNormalStrength: normalStrength,
    gamePbrInvertRoughness: invertRoughness,
    gamePbrReport: `${width}x${height} | SeamScore ${seamBefore.score} -> ${seamAfter.score} | 9-Slice [T:${b.top} B:${b.bottom} L:${b.left} R:${b.right}] | Hull ${hullVerts}v`
  })
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
  mode: 'loop_bgm' | 'bgm_intro_loop' | 'sfx_variants'
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

  const isBgmMode = mode === 'loop_bgm' || mode === 'bgm_intro_loop'
  const preset: GameAudioSynthPreset =
    ctx.node.params.gameAudioSynthPreset ?? (isBgmMode ? 'chiptune_bgm' : 'sword_slash')
  const synth = synthesizeGameSeedPcm(
    isBgmMode && !ctx.node.params.gameAudioSynthPreset ? 'chiptune_bgm' : preset,
    22050,
    {
      durationScale: Number(
        ctx.node.params.gameAudioSynthDuration ?? (mode === 'bgm_intro_loop' ? 1.8 : 1)
      ),
      basePitchSemitones: Number(ctx.node.params.gameAudioBasePitch ?? 0)
    }
  )
  return {
    ...synth,
    sourceName: isBgmMode ? 'bgm_synth' : `${preset}_synth`
  }
}

/**
 * `game.audioDsp`：游戏音频工坊节点。
 * - `loop_bgm`：对输入音频执行等功率正余弦首尾交叉淡化（Equal-Power Loop Crossfade），消除循环接缝爆音；
 * - `bgm_intro_loop`：在过零点将 BGM 切分为前奏（`*_intro.wav`）与无缝循环主段（`*_loop.wav`）；
 * - `sfx_variants`：首尾静音自动修剪（0ms 瞬态触发）+ N× Hermite 三次插值变调变速防听觉疲劳派生；
 * - 支持 6 类游戏声学环境滤镜与 -14/-16 LUFS 积分响度归一化。
 */
export async function executeGameAudioDspNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const modeRaw = ctx.node.params.gameAudioDspMode
  const mode: 'loop_bgm' | 'bgm_intro_loop' | 'sfx_variants' =
    modeRaw === 'sfx_variants'
      ? 'sfx_variants'
      : modeRaw === 'bgm_intro_loop'
        ? 'bgm_intro_loop'
        : 'loop_bgm'
  const crossfadeSec = Math.max(
    0.1,
    Math.min(8, Number(ctx.node.params.gameAudioCrossfadeSec ?? 1.5))
  )
  const introSec = Math.max(0.2, Math.min(30, Number(ctx.node.params.gameAudioIntroSec ?? 2.0)))
  const targetLufs =
    ctx.node.params.gameAudioTargetLufs != null
      ? Math.max(-30, Math.min(-6, Number(ctx.node.params.gameAudioTargetLufs)))
      : undefined
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
    if (normalize && targetLufs != null) {
      return normalizeIntegratedLufsPcm(withFx, targetLufs, -1.0).data
    }
    return normalize ? normalizePeakPcm(withFx, -1.0) : withFx
  }

  if (mode === 'bgm_intro_loop') {
    const shapedChannels = channels.map((ch) => postProcessChannel(ch))
    const splitRes = splitBgmIntroAndSeamlessLoop(shapedChannels, sampleRate, {
      introDurationSec: introSec,
      loopCrossfadeSec: crossfadeSec
    })
    const introWavDataUrl = encodePcmToWavDataUrl(splitRes.introChannels, sampleRate)
    const loopWavDataUrl = encodePcmToWavDataUrl(splitRes.loopChannels, sampleRate)

    let introRelPath = `Cache/Voices/${baseStem}_intro_${stamp}.wav`
    let loopRelPath = `Cache/Voices/${baseStem}_loop_${stamp}.wav`
    if (ctx.saveRunMedia) {
      const [savedLoop, savedIntro] = await Promise.all([
        ctx.saveRunMedia({
          dataUrl: loopWavDataUrl,
          key: buildGeneratedMediaFileKey({
            hostAssetName: ctx.resolveHostAssetName?.(),
            nodeTitle: `${baseStem}_loop`,
            stamp
          }),
          outputDir: ctx.node.params.mediaOutputDir?.trim() || 'Assets/GameAudio',
          node: ctx.node
        }),
        ctx.saveRunMedia({
          dataUrl: introWavDataUrl,
          key: buildGeneratedMediaFileKey({
            hostAssetName: ctx.resolveHostAssetName?.(),
            nodeTitle: `${baseStem}_intro`,
            stamp
          }),
          outputDir: ctx.node.params.mediaOutputDir?.trim() || 'Assets/GameAudio',
          node: ctx.node
        })
      ])
      if (savedLoop?.trim()) loopRelPath = savedLoop.trim()
      if (savedIntro?.trim()) introRelPath = savedIntro.trim()
    }
    batch.push(
      {
        id: `audio-dsp:${ctx.node.id}:${stamp}:loop`,
        createdAt,
        relativePath: loopRelPath
      },
      {
        id: `audio-dsp:${ctx.node.id}:${stamp}:intro`,
        createdAt,
        relativePath: introRelPath
      }
    )
    report = `BGM Intro+Loop | Intro ${splitRes.introDurationSec}s + Loop ${splitRes.loopDurationSec}s @ ${sampleRate}Hz | Crossfade ${crossfadeSec}s`
  } else if (mode === 'loop_bgm') {
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
    algorithmRaw === 'platformer_course' ||
    algorithmRaw === 'tower_defense' ||
    algorithmRaw === 'labyrinth_maze' ||
    algorithmRaw === 'node_graph_map'
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

  const connectivity = analyzeLevelConnectivityAndPacing(level)
  const topoInfo = level.topologyGraph
    ? ` | DAG: ${level.topologyGraph.layers}L/${level.topologyGraph.nodes.length}N/${level.topologyGraph.edges.length}E`
    : ''
  const report = `${algorithm} | ${width}x${height} (Seed ${seed}) | Rooms: ${level.rooms.length} | Entities: ${level.entities.length}${topoInfo} | Path: ${connectivity.reachable ? `${connectivity.pathLength} steps` : 'Blocked'}`
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

/**
 * `game.economy`：Machinations 风格游戏经济系统动力学建模与蒙特卡洛（Monte Carlo）数值平衡节点。
 * 同时输出高对比度「拓扑图 + P10/P50/P90 时序置信带曲线」预览图（`out`）与完整经济系统遥测/引擎脚本 JSON（`out-text`，可直接连入 `game.playable`）。
 */
export async function executeGameEconomyNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const templateRaw = String(ctx.node.params.gameEconomyPreset ?? 'roguelike_run')
  const templateId: MxTemplateId = (
    MX_TEMPLATES.some((t) => t.id === templateRaw) ? templateRaw : 'roguelike_run'
  ) as MxTemplateId

  // Check if upstream text provides a custom Machinations diagram JSON
  const textInputs = [
    ...(ctx.inputs.in ?? []),
    ...(ctx.inputs['in-text'] ?? []),
    ...collectIncomingValues(ctx.inputs)
  ]
  const incomingTexts = [
    ...flattenTextValues(textInputs).map((t) => t.text),
    ...flattenTextsValues(textInputs).map((t) => t.text)
  ].filter(Boolean)

  const rawDiagramJson =
    incomingTexts.find((t) => t.includes('"nodes"') && t.includes('"edges"')) ||
    ctx.node.params.gameEconomyDiagramJson

  const rawPromptParam = (ctx.node.params as Record<string, unknown>).prompt
  const naturalPrompts = [
    typeof rawPromptParam === 'string' ? rawPromptParam : '',
    typeof ctx.node.params.text === 'string' &&
    !ctx.node.params.text.includes('"machinations_economy_bundle"')
      ? ctx.node.params.text
      : '',
    typeof ctx.node.params.generateInstruction === 'string'
      ? ctx.node.params.generateInstruction
      : '',
    ...incomingTexts.filter(
      (t) =>
        !(t.includes('"nodes"') && t.includes('"edges"')) &&
        !t.includes('"machinations_economy_bundle"')
    ),
    ctx.node.title ?? ''
  ]
    .map((s) => s.trim())
    .filter(Boolean)
  const promptHint = naturalPrompts.join(' ')

  let doc: MxDocument
  const hasExplicitDiagram =
    (typeof rawDiagramJson === 'string' && rawDiagramJson.trim().length > 0) ||
    Boolean(rawDiagramJson && typeof rawDiagramJson === 'object')

  if (hasExplicitDiagram) {
    doc = parseMxDocumentJson(rawDiagramJson, templateId, ctx.node.title)
    // 若用户/AI 通过提示词或标题指定了新经济模板（如抽卡/塔防/锻造），而旧图仍是默认未改动的 roguelike_run，自动按提示词合成对应经济图
    if (doc.templateId === 'roguelike_run' && templateRaw === 'roguelike_run' && promptHint) {
      const matchedTpl = matchMxTemplateFromPrompt(promptHint)
      if (matchedTpl && matchedTpl !== 'roguelike_run') {
        doc = synthesizeMxDiagramFromPrompt(promptHint, matchedTpl, ctx.node.title)
      }
    }
  } else if (promptHint && templateRaw === 'roguelike_run') {
    doc = synthesizeMxDiagramFromPrompt(promptHint, templateId, ctx.node.title)
  } else {
    doc = parseMxDocumentJson(rawDiagramJson, templateId, ctx.node.title)
  }

  // 若图中包含 Interactive 玩家交互节点，且当前未配置启用任何 AI Agent 且 botMode 为 off，
  // 在无头执行（运行画布节点）时自动挂载 AI 效用智能体驱动交互动作，避免交互分支静默为 0
  const hasInteractiveNodes = doc.nodes.some((n) => n.trigger === 'interactive')
  const hasActiveAgent = Array.isArray(doc.agents) && doc.agents.some((a) => a.enabled)
  if (hasInteractiveNodes && !hasActiveAgent && (doc.settings.botMode ?? 'off') === 'off') {
    const autoAgent = generateMxAgentWithAi(doc, { prompt: promptHint })
    doc.agents = [...(doc.agents ?? []), autoAgent]
  }

  const paramSteps = Number(ctx.node.params.gameEconomySteps)
  const effectiveRawSteps =
    Number.isFinite(paramSteps) && paramSteps > 0 && (paramSteps !== 20 || !doc.settings.steps)
      ? paramSteps
      : (doc.settings.steps ?? 20)
  const steps = Math.max(1, Math.min(500, Math.round(effectiveRawSteps)))
  const runs = Math.max(
    1,
    Math.min(
      500,
      Math.round(Number(ctx.node.params.gameEconomyMonteCarloRuns ?? doc.settings.runs ?? 50))
    )
  )
  const seed = Math.floor(Number(ctx.node.params.gameEconomySeed ?? doc.settings.seed ?? 2026))
  doc.settings = { ...doc.settings, steps, runs, seed }
  const presetId = doc.templateId ?? templateId

  const forecast = runMxForecast(doc, { runs, steps, seed })
  const playRun = runMxSimulation(doc, { steps, seed, name: 'Play 1' })
  const healthReport = analyzeMxEconomyHealth(doc, playRun)
  const wb = doc.workbench ?? createMxWorkbenchPreset('slay_the_spire_dbg')
  doc.workbench = wb
  const wbMultiplier = analyzeMultiplierPipeline(wb.multiplier)
  const wbLoot = runMxLootAndSubstatSimulation({
    ...wb.lootRoll,
    runs: Math.min(400, runs * 5),
    seed
  })
  const wbCombat = runMxCombatKernelSimulation({
    ...wb.combatKernel,
    runs: Math.min(300, runs * 4),
    seed
  })
  const wbEnvelope = runMxRoguelikeEnvelopeSimulation({
    ...wb.roguelikeEnvelope,
    runs: Math.min(300, runs * 4),
    seed
  })
  const rendered = renderMxPreviewRgba(doc, forecast, 640, 400)
  const previewDataUrl = await encodeRgbaWithCtx(
    ctx,
    rendered.data,
    rendered.width,
    rendered.height
  )

  const stamp = formatGeneratedMediaStamp()
  const createdAt = new Date().toISOString()
  const batch: GraphImageItem[] = [
    {
      id: buildGeneratedMediaFileKey({
        nodeTitle: `economy_${presetId}_${steps}t_${runs}r`,
        stamp,
        index: 1
      }),
      dataUrl: previewDataUrl,
      title: `Machinations_${presetId}`,
      createdAt
    }
  ]

  const materialized = await materializeGeneratedBatch(
    ctx,
    batch,
    ctx.node.params.mediaOutputDir?.trim() || 'Assets/Economy'
  )

  const economyPayloadJson = JSON.stringify(
    {
      kind: 'machinations_economy_bundle',
      schemaVersion: 2,
      document: doc,
      forecast: {
        runs: forecast.runs,
        steps: forecast.steps,
        seed: forecast.seed,
        endHitRate: forecast.endHitRate,
        endStepP50: forecast.endStepP50,
        endReasons: forecast.endReasons,
        sourceSinkRatio: forecast.sourceSinkRatio,
        series: forecast.series.map((s) => ({
          nodeId: s.nodeId,
          label: s.label,
          p10: s.p10,
          p50: s.p50,
          p90: s.p90,
          mean: s.mean
        }))
      },
      play: {
        stepsRun: playRun.stepsRun,
        ended: playRun.ended,
        endReason: playRun.endReason,
        final: playRun.snapshots[playRun.snapshots.length - 1]
      },
      healthReport,
      workbenchReport: {
        activePresetId: wb.activePresetId,
        multiplier: wbMultiplier,
        lootRoll: wbLoot,
        combatKernel: wbCombat,
        roguelikeEnvelope: wbEnvelope
      },
      mermaidDiagram: exportMxToMermaid(doc),
      telemetryCsv: exportMxForecastCsv(doc, forecast),
      godotEconomyScriptGd: exportMxGodotGd(doc),
      unityEconomyScriptCs: exportMxUnityCs(doc)
    },
    null,
    2
  )

  let jsonRelativePath: string | undefined
  if (ctx.saveRunText) {
    try {
      jsonRelativePath = await ctx.saveRunText({
        content: economyPayloadJson,
        key: `economy_${presetId}_${steps}t_${seed}`,
        outputDir: ctx.node.params.mediaOutputDir?.trim() || 'Assets/Economy',
        node: ctx.node
      })
    } catch {
      /* ignore persist error */
    }
  }

  const goalStat =
    forecast.endStepP50 !== null
      ? `End P50: ${forecast.endStepP50} steps (${Math.round(forecast.endHitRate * 100)}%)`
      : 'End: never'
  const report = `${doc.title} | ${runs}x${steps} steps | Source/Sink: ${forecast.sourceSinkRatio}x | Health: ${healthReport.grade}(${healthReport.score}) | ${goalStat}`

  const cleanImages = materialized.map(stripEmbeddedImageData)
  const primaryPath = materialized[0]?.relativePath?.trim()
  const nextParams = {
    gameEconomyPreset: presetId as MxTemplateId,
    gameEconomySteps: steps,
    gameEconomyMonteCarloRuns: runs,
    gameEconomySeed: seed,
    gameEconomyDiagramJson: JSON.stringify(doc),
    gameEconomyReport: report,
    text: economyPayloadJson,
    generatedImages: cleanImages,
    selectedImageId: materialized[0]?.id,
    ...(primaryPath ? { imagePath: primaryPath } : {})
  }
  ctx.node.params = { ...ctx.node.params, ...nextParams }
  ctx.patchNode?.({ params: nextParams })

  const first = materialized[0]!
  const primaryOut: GraphValue = first.relativePath?.trim()
    ? { kind: 'image', relativePath: first.relativePath.trim(), dataUrl: '' }
    : { kind: 'image', dataUrl: first.dataUrl ?? '' }

  return {
    out: primaryOut,
    'out-all': { kind: 'images', items: materialized },
    'out-text': {
      kind: 'text',
      text: economyPayloadJson,
      ...(jsonRelativePath ? { relativePath: jsonRelativePath } : {})
    }
  }
}

/** 精灵嵌入前缩到这个长边 */
export const PLAYABLE_SPRITE_MAX_EDGE = 256
/** 地砖按 32–64px 平铺，128 足够且仍可无缝 */
export const PLAYABLE_TILE_MAX_EDGE = 128

/** 面积平均缩放到最长边 ≤ maxEdge（已更小则原样返回） */
export function downscaleRgbaToMaxEdge(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  maxEdge: number
): { data: Uint8ClampedArray; width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { data: rgba, width, height }
  const scale = maxEdge / longest
  const tw = Math.max(1, Math.round(width * scale))
  const th = Math.max(1, Math.round(height * scale))
  const out = new Uint8ClampedArray(tw * th * 4)
  for (let ty = 0; ty < th; ty++) {
    const sy0 = Math.floor((ty * height) / th)
    const sy1 = Math.max(sy0 + 1, Math.floor(((ty + 1) * height) / th))
    for (let tx = 0; tx < tw; tx++) {
      const sx0 = Math.floor((tx * width) / tw)
      const sx1 = Math.max(sx0 + 1, Math.floor(((tx + 1) * width) / tw))
      // alpha 加权平均，避免透明像素的颜色在边缘晕出黑 / 白边
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * width + sx) * 4
          const alpha = rgba[i + 3]!
          r += rgba[i]! * alpha
          g += rgba[i + 1]! * alpha
          b += rgba[i + 2]! * alpha
          a += alpha
          n++
        }
      }
      const o = (ty * tw + tx) * 4
      if (a > 0) {
        out[o] = r / a
        out[o + 1] = g / a
        out[o + 2] = b / a
      }
      out[o + 3] = a / n
    }
  }
  return { data: out, width: tw, height: th }
}

async function encodeWithCodec(
  codec: NodeExecuteContext['uiRgbaCodec'],
  data: Uint8ClampedArray,
  width: number,
  height: number
): Promise<string> {
  let encoded = ''
  if (codec?.encodeRgbaPng) {
    try {
      encoded = await codec.encodeRgbaPng({ width, height, data })
    } catch {
      encoded = ''
    }
  }
  if (!encoded?.startsWith('data:image/')) encoded = encodeRgbaToPngDataUrl(data, width, height)
  return encoded
}

/**
 * 沙盒精灵预处理：解码 → 先缩到 maxEdge（抠图与编码都在小图上做，快且产物小）→
 * 可选自动抠底（四边泛洪，主体内部同色区域不与边界连通，不会被挖空）→ 裁到内容包围盒 → 编码。
 * 解码 / 编码不可用或出错时返回原图，绝不中断执行。
 */
export async function prepareSandboxSprite(
  codec: NodeExecuteContext['uiRgbaCodec'],
  url: string,
  options: { maxEdge: number; key: boolean }
): Promise<{ url: string; keyed: boolean }> {
  if (!codec?.decodeImageRgba) return { url, keyed: false }
  try {
    const decoded = await codec.decodeImageRgba(url)
    const srcW = Math.floor(decoded.width)
    const srcH = Math.floor(decoded.height)
    if (srcW < 4 || srcH < 4) return { url, keyed: false }
    const scaled = downscaleRgbaToMaxEdge(
      new Uint8ClampedArray(decoded.data),
      srcW,
      srcH,
      options.maxEdge
    )
    const downscaled = scaled.width !== srcW || scaled.height !== srcH
    const { width, height } = scaled
    const rgba = downscaled ? scaled.data : new Uint8ClampedArray(scaled.data)

    let keyed = false
    if (options.key && !hasNativeTransparentPixels(rgba, width, height)) {
      const probe = new Uint8ClampedArray(rgba)
      const result = applyBorderFloodColorKey(probe, width, height)
      if (result.keyedRatio >= 0.02 && result.keyedRatio <= 0.97) {
        rgba.set(probe)
        keyed = true
      }
    }
    if (!keyed && !downscaled) return { url, keyed: false }

    let minX = 0
    let minY = 0
    let maxX = width - 1
    let maxY = height - 1
    if (keyed) {
      minX = width
      minY = height
      maxX = -1
      maxY = -1
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (rgba[(y * width + x) * 4 + 3]! > 8) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }
      if (maxX < minX || maxY < minY) return { url, keyed: false }
      const pad = 2
      minX = Math.max(0, minX - pad)
      minY = Math.max(0, minY - pad)
      maxX = Math.min(width - 1, maxX + pad)
      maxY = Math.min(height - 1, maxY + pad)
    }
    const cw = maxX - minX + 1
    const ch = maxY - minY + 1
    let out = rgba
    if (cw !== width || ch !== height) {
      out = new Uint8ClampedArray(cw * ch * 4)
      for (let y = 0; y < ch; y++) {
        const srcStart = ((minY + y) * width + minX) * 4
        out.set(rgba.subarray(srcStart, srcStart + cw * 4), y * cw * 4)
      }
    }
    const encoded = await encodeWithCodec(codec, out, cw, ch)
    return encoded ? { url: encoded, keyed } : { url, keyed: false }
  } catch {
    return { url, keyed: false }
  }
}

/** 兼容旧调用：角色精灵抠底 + 缩到 PLAYABLE_SPRITE_MAX_EDGE */
export async function autoKeySpriteBackground(
  codec: NodeExecuteContext['uiRgbaCodec'],
  url: string
): Promise<{ url: string; keyed: boolean }> {
  return prepareSandboxSprite(codec, url, { maxEdge: PLAYABLE_SPRITE_MAX_EDGE, key: true })
}
