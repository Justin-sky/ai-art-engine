import {
  isLayerSplitBase,
  isLayerSplitLayerDrawable,
  sortLayersForCompose,
  type ImageLayerSplitLayer,
  type ImageLayerSplitState
} from './imageLayerSplit'
import { getUiControlSpec } from './uiControlSpec'

export interface UiEngineLayerBinding {
  layer: ImageLayerSplitLayer
  fileName: string
  role: 'base' | 'button' | 'panel' | 'topbar' | 'widget'
}

export function classifyUiLayerRole(
  state: ImageLayerSplitState,
  layer: ImageLayerSplitLayer
): 'base' | 'button' | 'panel' | 'topbar' | 'widget' {
  if (isLayerSplitBase(layer)) return 'base'
  if (
    layer.uiControlType === 'button' ||
    layer.uiControlType === 'toggle' ||
    layer.uiControlType === 'slider'
  ) {
    return 'button'
  }
  if (layer.uiControlType === 'hud-bar' || layer.uiControlType === 'tab-bar') {
    return 'topbar'
  }
  if (layer.uiControlType === 'panel' || layer.uiControlType === 'list-view') {
    return 'panel'
  }
  const group = state.groups.find((g) => g.id === layer.groupId)
  const hay = `${layer.name ?? ''} ${layer.description ?? ''} ${group?.name ?? ''}`.toLowerCase()
  if (/按钮|button|btn|cta|交互|开关|图标|icon|tab|切页|镶嵌|升阶|购买|领取/i.test(hay)) {
    return 'button'
  }
  if (/顶栏|topbar|header|hud|状态|货币|横幅|标题/i.test(hay)) {
    return 'topbar'
  }
  if (layer.nineSliceBorders || /面板|panel|容器|底框|frame|card|立绘|弹窗|dialog/i.test(hay)) {
    return 'panel'
  }
  const canvasArea = Math.max(1, (state.canvasWidth || 1280) * (state.canvasHeight || 720))
  const ratio = (layer.width * layer.height) / canvasArea
  if (ratio <= 0.08 && layer.width >= 48 && layer.height >= 28) {
    return 'button'
  }
  return 'widget'
}

function sanitizeNodeIdentifier(raw: string, fallback: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned || fallback
}

/**
 * 生成 Godot 4 `.tscn` 界面场景文件（支持 TextureRect、NinePatchRect 九宫格面板与带 Normal/Pressed/Hover 三态绑定的 TextureButton）。
 */
export function buildGodotSceneTscn(input: {
  state: ImageLayerSplitState
  /** layer.id → 导出切片相对文件名（如 `layers/01_button.png`） */
  layerFileNames: Record<string, string>
  sceneName?: string
}): string {
  const { state, layerFileNames } = input
  const rootName = sanitizeNodeIdentifier(input.sceneName || 'GameUiScreen', 'GameUiScreen')
  const allLayers = sortLayersForCompose(state.layers)
  const drawable = allLayers.filter((layer) => isLayerSplitLayerDrawable(state, layer))

  const extResources: string[] = []
  const resIdByLayerId = new Map<string, string>()
  allLayers.forEach((layer, idx) => {
    const resId = `tex_${idx + 1}`
    const relFile = layerFileNames[layer.id] || `layers/layer_${layer.zIndex}.png`
    extResources.push(`[ext_resource type="Texture2D" path="res://${relFile}" id="${resId}"]`)
    resIdByLayerId.set(layer.id, resId)
  })

  const nodeBlocks: string[] = []

  drawable.forEach((layer) => {
    const resId = resIdByLayerId.get(layer.id) || 'tex_1'
    const role = classifyUiLayerRole(state, layer)
    const nodeName = sanitizeNodeIdentifier(layer.name, `Layer_${layer.zIndex}`)
    const isBase = role === 'base'
    const left = isBase ? 0 : Math.round(layer.left)
    const top = isBase ? 0 : Math.round(layer.top)
    const right = left + (isBase ? Math.round(state.canvasWidth || 1280) : Math.round(layer.width))
    const bottom = top + (isBase ? Math.round(state.canvasHeight || 720) : Math.round(layer.height))

    if (role === 'button' && (!layer.uiPartRole || layer.uiPartRole === 'button-bg-normal')) {
      const siblings = layer.uiControlId
        ? allLayers.filter((s) => s.uiControlId === layer.uiControlId)
        : []
      const pressedSibling = siblings.find((s) => s.uiPartRole === 'button-bg-pressed')
      const hoverSibling = siblings.find((s) => s.uiPartRole === 'button-bg-hover')
      const pressedResId = pressedSibling ? resIdByLayerId.get(pressedSibling.id) : undefined
      const hoverResId = hoverSibling ? resIdByLayerId.get(hoverSibling.id) : undefined

      nodeBlocks.push(
        [
          `[node name="${nodeName}" type="TextureButton" parent="."]`,
          `layout_mode = 0`,
          `offset_left = ${left}.0`,
          `offset_top = ${top}.0`,
          `offset_right = ${right}.0`,
          `offset_bottom = ${bottom}.0`,
          `texture_normal = ExtResource("${resId}")`,
          ...(pressedResId ? [`texture_pressed = ExtResource("${pressedResId}")`] : []),
          ...(hoverResId ? [`texture_hover = ExtResource("${hoverResId}")`] : []),
          `ignore_texture_size = true`,
          `stretch_mode = 0`
        ].join('\n')
      )
      return
    }

    if (layer.nineSliceBorders) {
      const [bL, bT, bR, bB] = layer.nineSliceBorders
      nodeBlocks.push(
        [
          `[node name="${nodeName}" type="NinePatchRect" parent="."]`,
          `layout_mode = 0`,
          `offset_left = ${left}.0`,
          `offset_top = ${top}.0`,
          `offset_right = ${right}.0`,
          `offset_bottom = ${bottom}.0`,
          `texture = ExtResource("${resId}")`,
          `patch_margin_left = ${Math.round(bL)}`,
          `patch_margin_top = ${Math.round(bT)}`,
          `patch_margin_right = ${Math.round(bR)}`,
          `patch_margin_bottom = ${Math.round(bB)}`
        ].join('\n')
      )
      return
    }

    nodeBlocks.push(
      [
        `[node name="${nodeName}" type="TextureRect" parent="."]`,
        `layout_mode = 0`,
        `offset_left = ${left}.0`,
        `offset_top = ${top}.0`,
        `offset_right = ${right}.0`,
        `offset_bottom = ${bottom}.0`,
        `texture = ExtResource("${resId}")`,
        `expand_mode = 1`
      ].join('\n')
    )
  })

  const loadSteps = extResources.length + 1
  return [
    `[gd_scene load_steps=${loadSteps} format=3]`,
    '',
    ...extResources,
    '',
    `[node name="${rootName}" type="Control"]`,
    `layout_mode = 3`,
    `anchors_preset = 15`,
    `anchor_right = 1.0`,
    `anchor_bottom = 1.0`,
    `grow_horizontal = 2`,
    `grow_vertical = 2`,
    '',
    ...nodeBlocks.flatMap((block) => [block, ''])
  ].join('\n')
}

/**
 * 生成 Unity UI Toolkit 标准界面布局文件（`GameUiScreen.uxml`）：
 * 采用 `UnityEngine.UIElements` 标准控件规范（`<ui:Button>`, `<ui:Slider>`, `<ui:ProgressBar>`, `<ui:ListView>`, `<ui:TabView>`, `<ui:GroupBox>`），
 * 将同一控件下的背景、图标、文字组织为标准 VisualTree 层级。
 */
export function buildUnityUiToolkitUxml(input: {
  state: ImageLayerSplitState
  styleSheetName?: string
  screenName?: string
}): string {
  const { state } = input
  const styleFile = input.styleSheetName?.trim() || 'GameUiScreen.uss'
  const rootName = sanitizeNodeIdentifier(input.screenName || 'GameUiRoot', 'GameUiRoot')
  const allLayers = sortLayersForCompose(state.layers)
  const emittedControlIds = new Set<string>()
  const lines: string[] = [
    `<ui:UXML xmlns:ui="UnityEngine.UIElements" xmlns:uie="UnityEditor.UIElements" editor-extension-mode="False">`,
    `  <Style src="${escapeHtml(styleFile)}" />`,
    `  <ui:VisualElement name="${escapeHtml(rootName)}" class="ui-screen-root">`
  ]

  for (const layer of allLayers) {
    if (isLayerSplitBase(layer)) {
      const cls = `layer-${sanitizeNodeIdentifier(layer.id, 'base')}`
      lines.push(`    <ui:VisualElement name="CanvasBase" class="ui-canvas-base ${cls}" />`)
      continue
    }

    const cid = layer.uiControlId?.trim() || ''
    if (cid) {
      if (emittedControlIds.has(cid)) continue
      emittedControlIds.add(cid)
      const siblings = allLayers.filter((s) => s.uiControlId === cid)
      const cSpec = getUiControlSpec(layer.uiControlType)
      const ctrlName = sanitizeNodeIdentifier(
        layer.uiControlName || layer.name.split('·')[0] || cid,
        cid
      )
      const ctrlClass = `ctrl-${sanitizeNodeIdentifier(cid, 'ctrl')}`

      if (cSpec.type === 'button') {
        const bgNormal = siblings.find((s) => s.uiPartRole === 'button-bg-normal') ?? layer
        const bgClass = `layer-${sanitizeNodeIdentifier(bgNormal.id, 'btn-bg')}`
        const iconPart = siblings.find((s) => s.uiPartRole === 'button-icon')
        const labelPart = siblings.find((s) => s.uiPartRole === 'button-label')
        lines.push(
          `    <ui:Button name="${escapeHtml(ctrlName)}" class="${cSpec.unityUssClass} ${ctrlClass} ${bgClass}">`
        )
        if (iconPart) {
          const iconClass = `layer-${sanitizeNodeIdentifier(iconPart.id, 'btn-icon')}`
          lines.push(
            `      <ui:VisualElement name="${escapeHtml(ctrlName)}_Icon" class="unity-button__image ${iconClass}" />`
          )
        }
        if (labelPart) {
          const labelClass = `layer-${sanitizeNodeIdentifier(labelPart.id, 'btn-label')}`
          lines.push(
            `      <ui:Label name="${escapeHtml(ctrlName)}_Label" text="${escapeHtml(layer.uiControlName || layer.name)}" class="unity-button__text ${labelClass}" />`
          )
        }
        lines.push(`    </ui:Button>`)
        continue
      }

      if (cSpec.type === 'slider' || cSpec.type === 'progress-bar') {
        const tag = cSpec.type === 'slider' ? 'ui:Slider' : 'ui:ProgressBar'
        lines.push(
          `    <${tag} name="${escapeHtml(ctrlName)}" low-value="0" high-value="100" value="65" class="${cSpec.unityUssClass} ${ctrlClass}">`
        )
        for (const sub of siblings) {
          const subClass = `layer-${sanitizeNodeIdentifier(sub.id, 'part')}`
          const subId = sanitizeNodeIdentifier(sub.uiPartRole || sub.name, 'part')
          lines.push(`      <ui:VisualElement name="${escapeHtml(subId)}" class="${subClass}" />`)
        }
        lines.push(`    </${tag}>`)
        continue
      }

      const containerTag =
        cSpec.type === 'list-view'
          ? 'ui:ListView'
          : cSpec.type === 'tab-bar'
            ? 'ui:TabView'
            : cSpec.type === 'dropdown'
              ? 'ui:DropdownField'
              : cSpec.type === 'radio-button'
                ? 'ui:RadioButton'
                : cSpec.type === 'toggle'
                  ? 'ui:Toggle'
                  : cSpec.type === 'text-field'
                    ? 'ui:TextField'
                    : cSpec.type === 'scroller'
                      ? 'ui:Scroller'
                      : cSpec.type === 'foldout'
                        ? 'ui:Foldout'
                        : cSpec.type === 'item-slot' || cSpec.type === 'radial-progress'
                          ? 'ui:VisualElement'
                          : 'ui:GroupBox'
      lines.push(
        `    <${containerTag} name="${escapeHtml(ctrlName)}" class="${cSpec.unityUssClass} ${ctrlClass}">`
      )
      for (const sub of siblings) {
        if (!sub.visible) continue
        const subClass = `layer-${sanitizeNodeIdentifier(sub.id, 'part')}`
        const subName = sanitizeNodeIdentifier(sub.name, `Part_${sub.zIndex}`)
        if (sub.editableText?.text) {
          lines.push(
            `      <ui:Label name="${escapeHtml(subName)}" text="${escapeHtml(sub.editableText.text)}" class="${subClass}" />`
          )
        } else {
          lines.push(`      <ui:VisualElement name="${escapeHtml(subName)}" class="${subClass}" />`)
        }
      }
      lines.push(`    </${containerTag}>`)
      continue
    }

    if (!isLayerSplitLayerDrawable(state, layer)) continue
    const cls = `layer-${sanitizeNodeIdentifier(layer.id, `z${layer.zIndex}`)}`
    const nodeName = sanitizeNodeIdentifier(layer.name, `Layer_${layer.zIndex}`)
    lines.push(
      `    <ui:VisualElement name="${escapeHtml(nodeName)}" class="ui-layer-item ${cls}" />`
    )
  }

  lines.push(`  </ui:VisualElement>`)
  lines.push(`</ui:UXML>`)
  return lines.join('\n')
}

/**
 * 生成 Unity UI Toolkit 样式表（`GameUiScreen.uss`）：
 * 自动输出每个控件与子部件的绝对定位坐标、九宫格切片参数（`-unity-slice-*`）以及按钮 `:hover` / `:active` 伪类状态图切换。
 */
export function buildUnityUiToolkitUss(input: {
  state: ImageLayerSplitState
  layerFileNames: Record<string, string>
}): string {
  const { state, layerFileNames } = input
  const cw = Math.max(1, Math.round(state.canvasWidth || 1280))
  const ch = Math.max(1, Math.round(state.canvasHeight || 720))
  const allLayers = sortLayersForCompose(state.layers)
  const rules: string[] = [
    `.ui-screen-root {`,
    `  position: relative;`,
    `  width: ${cw}px;`,
    `  height: ${ch}px;`,
    `  overflow: hidden;`,
    `}`,
    `.ui-canvas-base {`,
    `  position: absolute;`,
    `  left: 0px;`,
    `  top: 0px;`,
    `  width: ${cw}px;`,
    `  height: ${ch}px;`,
    `}`
  ]

  for (const layer of allLayers) {
    const cls = `layer-${sanitizeNodeIdentifier(layer.id, isLayerSplitBase(layer) ? 'base' : `z${layer.zIndex}`)}`
    const relFile = layerFileNames[layer.id] || `layers/layer_${layer.zIndex}.png`
    const isBase = isLayerSplitBase(layer)
    const left = isBase ? 0 : Math.round(layer.left)
    const top = isBase ? 0 : Math.round(layer.top)
    const width = isBase ? cw : Math.max(1, Math.round(layer.width))
    const height = isBase ? ch : Math.max(1, Math.round(layer.height))

    const sliceLines = layer.nineSliceBorders
      ? [
          `  -unity-slice-left: ${Math.round(layer.nineSliceBorders[0])};`,
          `  -unity-slice-top: ${Math.round(layer.nineSliceBorders[1])};`,
          `  -unity-slice-right: ${Math.round(layer.nineSliceBorders[2])};`,
          `  -unity-slice-bottom: ${Math.round(layer.nineSliceBorders[3])};`
        ]
      : []

    rules.push(
      [
        `.${cls} {`,
        `  position: absolute;`,
        `  left: ${left}px;`,
        `  top: ${top}px;`,
        `  width: ${width}px;`,
        `  height: ${height}px;`,
        `  background-image: url("${relFile}");`,
        ...sliceLines,
        `}`
      ].join('\n')
    )

    // 若为 Button 常态底板，自动生成 :hover 与 :active 伪类规则绑定悬停与按下状态图
    if (layer.uiPartRole === 'button-bg-normal' && layer.uiControlId) {
      const siblings = allLayers.filter((s) => s.uiControlId === layer.uiControlId)
      const hoverSibling = siblings.find((s) => s.uiPartRole === 'button-bg-hover')
      const pressedSibling = siblings.find((s) => s.uiPartRole === 'button-bg-pressed')
      if (hoverSibling) {
        const hoverFile =
          layerFileNames[hoverSibling.id] || `layers/layer_${hoverSibling.zIndex}.png`
        rules.push([`.${cls}:hover {`, `  background-image: url("${hoverFile}");`, `}`].join('\n'))
      }
      if (pressedSibling) {
        const pressedFile =
          layerFileNames[pressedSibling.id] || `layers/layer_${pressedSibling.zIndex}.png`
        rules.push(
          [
            `.${cls}:active {`,
            `  background-image: url("${pressedFile}");`,
            `  translate: 0px 1px;`,
            `}`
          ].join('\n')
        )
      }
    }
  }

  return rules.join('\n\n')
}

/**
 * 生成 Unity UGUI 自动化装配脚本（`AiArtUiPrefabBuilder.cs`）：
 * 放入 Unity `Assets/Editor/` 后，在顶部菜单点击 `Tools/AI Art Engine/Build UI Canvas From Manifest`
 * 即可一键按 `ui-manifest.json` 组装带 RectTransform、九宫格切片与 Button 组件的完整 UGUI Canvas。
 */
export function buildUnityUguiEditorScriptCs(): string {
  return `// Auto-generated by AI Art Engine — Place inside Assets/Editor/ in Unity
#if UNITY_EDITOR
using System;
using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace AiArtEngine.Editor
{
    [Serializable]
    public class UiLayerEntry
    {
        public string id;
        public string name;
        public string file;
        public string role;
        public int zIndex;
        public int left;
        public int top;
        public int width;
        public int height;
        public int[] nineSliceBorders;
    }

    [Serializable]
    public class UiManifestDoc
    {
        public int canvasWidth = 1280;
        public int canvasHeight = 720;
        public UiLayerEntry[] layers;
    }

    public static class AiArtUiPrefabBuilder
    {
        [MenuItem("Tools/AI Art Engine/Build UI Canvas From Manifest JSON...")]
        public static void BuildFromManifest()
        {
            string jsonPath = EditorUtility.OpenFilePanel("Select ui-manifest.json", Application.dataPath, "json");
            if (string.IsNullOrEmpty(jsonPath)) return;

            string json = File.ReadAllText(jsonPath);
            var doc = JsonUtility.FromJson<UiManifestDoc>(json);
            if (doc == null || doc.layers == null) return;

            var rootGo = new GameObject("AIArt_UICanvas", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            var canvas = rootGo.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = rootGo.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(doc.canvasWidth, doc.canvasHeight);

            foreach (var layer in doc.layers)
            {
                var child = new GameObject(string.IsNullOrEmpty(layer.name) ? layer.id : layer.name, typeof(RectTransform), typeof(CanvasRenderer), typeof(Image));
                child.transform.SetParent(rootGo.transform, false);
                var rt = child.GetComponent<RectTransform>();
                rt.anchorMin = new Vector2(0f, 1f);
                rt.anchorMax = new Vector2(0f, 1f);
                rt.pivot = new Vector2(0f, 1f);
                rt.anchoredPosition = new Vector2(layer.left, -layer.top);
                rt.sizeDelta = new Vector2(Math.Max(1, layer.width), Math.Max(1, layer.height));

                if (layer.role == "button" || (layer.name != null && layer.name.Contains("按钮")))
                {
                    child.AddComponent<Button>();
                }
            }

            Selection.activeGameObject = rootGo;
            Debug.Log("[AI Art Engine] Built UGUI Canvas with " + doc.layers.Length + " layers.");
        }
    }
}
#endif
`
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 生成单文件自包含「可点击交互 HTML5 游戏 UI 原型 + 3D 全息爆炸拆解查看器」。
 * - 所有按钮图层自动附加悬停高光、按下状态图切换（Pressed BG / Hover BG）、点击 Q 弹反馈与 WebAudio 合成音效；
 * - 内置「🕹️ 交互试玩模式」与「🧊 3D 爆炸拆解模式」一键切换；
 * - 右侧自带实时图层树开关与标准 UI 控件类型/角色检视器。
 */
export function buildInteractiveUiPrototypeHtml(input: {
  state: ImageLayerSplitState
  layerUrls: Record<string, string>
  title?: string
}): string {
  const { state, layerUrls } = input
  const title = escapeHtml(input.title?.trim() || 'Game UI Interactive Prototype')
  const cw = Math.max(1, Math.round(state.canvasWidth) || 1280)
  const ch = Math.max(1, Math.round(state.canvasHeight) || 720)
  const allLayers = sortLayersForCompose(state.layers)
  const drawable = allLayers.filter((layer) => isLayerSplitLayerDrawable(state, layer))

  const serializedLayers = drawable.map((layer, rank) => {
    const url = layerUrls[layer.imageId]?.trim() || layerUrls[layer.id]?.trim() || ''
    const role = classifyUiLayerRole(state, layer)
    const isBase = role === 'base'
    let hoverUrl = ''
    let pressedUrl = ''
    if (layer.uiControlId && (!layer.uiPartRole || layer.uiPartRole === 'button-bg-normal')) {
      const siblings = allLayers.filter((s) => s.uiControlId === layer.uiControlId)
      const hoverLayer = siblings.find((s) => s.uiPartRole === 'button-bg-hover')
      const pressedLayer = siblings.find((s) => s.uiPartRole === 'button-bg-pressed')
      if (hoverLayer) {
        hoverUrl = layerUrls[hoverLayer.imageId]?.trim() || layerUrls[hoverLayer.id]?.trim() || ''
      }
      if (pressedLayer) {
        pressedUrl =
          layerUrls[pressedLayer.imageId]?.trim() || layerUrls[pressedLayer.id]?.trim() || ''
      }
    }
    return {
      id: layer.id,
      name: layer.name || (isBase ? 'Base' : `Layer ${layer.zIndex}`),
      zIndex: layer.zIndex,
      rank,
      role,
      uiControlType: layer.uiControlType || null,
      uiPartRole: layer.uiPartRole || null,
      isBase,
      left: isBase ? 0 : Math.round(layer.left),
      top: isBase ? 0 : Math.round(layer.top),
      width: isBase ? cw : Math.max(1, Math.round(layer.width)),
      height: isBase ? ch : Math.max(1, Math.round(layer.height)),
      nineSlice: layer.nineSliceBorders ?? null,
      url,
      hoverUrl,
      pressedUrl
    }
  })

  const payloadJson = JSON.stringify({
    canvasWidth: cw,
    canvasHeight: ch,
    layers: serializedLayers
  }).replace(/</g, '\\u003c')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
  body {
    background: radial-gradient(circle at 50% 25%, #1e293b 0%, #090d16 100%);
    color: #f8fafc;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  header {
    height: 52px;
    padding: 0 18px;
    background: rgba(15, 23, 42, 0.88);
    border-bottom: 1px solid rgba(148, 163, 184, 0.18);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    backdrop-filter: blur(12px);
    z-index: 20;
  }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 14px; }
  .badge {
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    background: linear-gradient(135deg, #f59e0b, #ef4444);
    color: #fff;
  }
  .controls { display: flex; align-items: center; gap: 10px; }
  .btn {
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid rgba(148, 163, 184, 0.28);
    background: rgba(30, 41, 59, 0.85);
    color: #e2e8f0;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.16s ease;
  }
  .btn:hover { border-color: #38bdf8; color: #fff; }
  .btn.active {
    background: linear-gradient(135deg, #0284c7, #6366f1);
    border-color: #7dd3fc;
    color: #fff;
    box-shadow: 0 0 16px rgba(56, 189, 248, 0.35);
  }
  main { flex: 1; display: flex; min-height: 0; position: relative; }
  .stage-viewport {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    perspective: 1600px;
    overflow: hidden;
    position: relative;
  }
  .ui-canvas {
    position: relative;
    transform-style: preserve-3d;
    transition: transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.65);
    border-radius: 12px;
  }
  .ui-layer {
    position: absolute;
    transform-style: preserve-3d;
    transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1), filter 0.2s ease, box-shadow 0.2s ease;
  }
  .ui-layer img {
    width: 100%;
    height: 100%;
    display: block;
    pointer-events: none;
  }
  .ui-layer.role-button {
    cursor: pointer;
  }
  .ui-layer.role-button:hover {
    filter: brightness(1.14) drop-shadow(0 0 12px rgba(251, 191, 36, 0.55));
  }
  .ui-layer.role-button:active {
    transform: scale(0.95) !important;
  }
  .exploded .ui-layer {
    outline: 1.5px solid rgba(56, 189, 248, 0.55);
    box-shadow: -12px 18px 28px rgba(0, 0, 0, 0.45);
  }
  .layer-tag {
    position: absolute;
    left: 0;
    top: -22px;
    padding: 2px 7px;
    border-radius: 4px;
    background: rgba(15, 23, 42, 0.9);
    border: 1px solid rgba(56, 189, 248, 0.5);
    color: #7dd3fc;
    font-size: 11px;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
  }
  .exploded:not(.hide-labels) .layer-tag { opacity: 1; }
  aside {
    width: 280px;
    background: rgba(15, 23, 42, 0.92);
    border-left: 1px solid rgba(148, 163, 184, 0.16);
    padding: 14px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .side-title { font-size: 12px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
  .layer-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border-radius: 8px;
    background: rgba(30, 41, 59, 0.65);
    border: 1px solid rgba(148, 163, 184, 0.14);
    font-size: 12px;
    cursor: pointer;
  }
  .layer-row:hover { border-color: #38bdf8; }
  .role-pill {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 4px;
    background: rgba(56, 189, 248, 0.16);
    color: #38bdf8;
  }
  .role-pill.button { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
  .toast {
    position: fixed;
    bottom: 22px;
    left: 50%;
    transform: translateX(-50%);
    padding: 8px 16px;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.92);
    border: 1px solid #fbbf24;
    color: #fde68a;
    font-size: 13px;
    font-weight: 600;
    opacity: 0;
    transition: opacity 0.2s ease;
    pointer-events: none;
  }
  .toast.show { opacity: 1; }
</style>
</head>
<body>
  <header>
    <div class="brand">
      <span>🎮 ${title}</span>
      <span class="badge">Interactive UI Prototype</span>
    </div>
    <div class="controls">
      <button id="modePlayBtn" class="btn active">🕹️ 交互试玩 (2D Playable)</button>
      <button id="mode3dBtn" class="btn">🧊 3D 全息爆炸视图 (3D Explode)</button>
      <button id="toggleLabelsBtn" class="btn active" title="在 3D 爆炸视图中显示/隐藏图层名称标签">🏷️ 图层名 (Labels)</button>
      <label style="font-size:12px;color:#94a3b8;display:flex;align-items:center;gap:6px;">
        Z 轴层距
        <input id="gapSlider" type="range" min="2" max="48" value="12" />
      </label>
    </div>
  </header>
  <main>
    <div id="viewport" class="stage-viewport">
      <div id="canvas" class="ui-canvas"></div>
    </div>
    <aside>
      <div class="side-title">UI 图层与组件树</div>
      <div id="layerList" style="display:flex;flex-direction:column;gap:6px;"></div>
    </aside>
  </main>
  <div id="toast" class="toast"></div>
<script>
  const DOC = ${payloadJson};
  const canvasEl = document.getElementById('canvas');
  const viewportEl = document.getElementById('viewport');
  const layerListEl = document.getElementById('layerList');
  const toastEl = document.getElementById('toast');
  const modePlayBtn = document.getElementById('modePlayBtn');
  const mode3dBtn = document.getElementById('mode3dBtn');
  const toggleLabelsBtn = document.getElementById('toggleLabelsBtn');
  const gapSlider = document.getElementById('gapSlider');

  let exploded = false;
  let showLabels = true;
  let gap = 12;
  let rotX = 18;
  let rotY = -26;
  let scale = 0.68;
  const hiddenIds = new Set();

  function playClickSfx(freq = 660) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.45, ctx.currentTime + 0.09);
      gain.gain.setValueAtTime(0.16, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.11);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch {}
  }

  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }

  function updateTransform() {
    const vw = viewportEl.clientWidth - 48;
    const vh = viewportEl.clientHeight - 48;
    scale = Math.min(1, vw / DOC.canvasWidth, vh / DOC.canvasHeight) * (exploded ? 0.78 : 0.92);
    canvasEl.classList.toggle('hide-labels', !showLabels);
    if (exploded) {
      canvasEl.classList.add('exploded');
      canvasEl.style.transform = \`scale(\${scale}) rotateX(\${rotX}deg) rotateY(\${rotY}deg)\`;
    } else {
      canvasEl.classList.remove('exploded');
      canvasEl.style.transform = \`scale(\${scale})\`;
    }
    const visibleEls = Array.from(document.querySelectorAll('.ui-layer')).filter((el) => el.style.display !== 'none');
    const count = visibleEls.length;
    const effectiveGap = count > 1 ? Math.min(gap, (gap * 9) / (count - 1)) : 0;
    const centerRank = (count - 1) / 2;
    visibleEls.forEach((el, idx) => {
      const zOffset = Math.round((idx - centerRank) * effectiveGap);
      el.style.transform = exploded ? \`translateZ(\${zOffset}px)\` : 'translateZ(0px)';
    });
  }

  function render() {
    canvasEl.style.width = DOC.canvasWidth + 'px';
    canvasEl.style.height = DOC.canvasHeight + 'px';
    canvasEl.innerHTML = '';
    layerListEl.innerHTML = '';

    DOC.layers.forEach((layer) => {
      const el = document.createElement('div');
      el.className = \`ui-layer role-\${layer.role}\`;
      el.dataset.rank = String(layer.rank);
      el.style.left = layer.left + 'px';
      el.style.top = layer.top + 'px';
      el.style.width = layer.width + 'px';
      el.style.height = layer.height + 'px';
      el.style.zIndex = String(layer.zIndex + 1);
      el.style.display = hiddenIds.has(layer.id) ? 'none' : 'block';

      const tag = document.createElement('span');
      tag.className = 'layer-tag';
      tag.textContent = \`z\${layer.zIndex} · \${layer.name}\`;
      el.appendChild(tag);

      const img = document.createElement('img');
      img.src = layer.url;
      el.appendChild(img);

      if (layer.role === 'button') {
        if (layer.hoverUrl) {
          el.addEventListener('pointerenter', () => { img.src = layer.hoverUrl; });
          el.addEventListener('pointerleave', () => { img.src = layer.url; });
        }
        if (layer.pressedUrl) {
          el.addEventListener('pointerdown', () => { img.src = layer.pressedUrl; });
          el.addEventListener('pointerup', () => { img.src = layer.hoverUrl || layer.url; });
        }
        el.addEventListener('click', () => {
          playClickSfx(720);
          showToast(\`⚡ 触发交互组件：\${layer.name} (x:\${layer.left}, y:\${layer.top})\`);
        });
      }
      canvasEl.appendChild(el);

      const row = document.createElement('div');
      row.className = 'layer-row';
      const badgeLabel = layer.uiControlType ? \`\${layer.uiControlType}\${layer.uiPartRole ? ' · ' + layer.uiPartRole : ''}\` : layer.role;
      row.innerHTML = \`<span>\${hiddenIds.has(layer.id) ? '🚫' : '👁️'} \${layer.name}</span><span class="role-pill \${layer.role}">\${badgeLabel}</span>\`;
      row.addEventListener('click', () => {
        if (hiddenIds.has(layer.id)) hiddenIds.delete(layer.id);
        else hiddenIds.add(layer.id);
        render();
      });
      layerListEl.appendChild(row);
    });

    updateTransform();
  }

  modePlayBtn.addEventListener('click', () => {
    exploded = false;
    modePlayBtn.classList.add('active');
    mode3dBtn.classList.remove('active');
    updateTransform();
  });

  mode3dBtn.addEventListener('click', () => {
    exploded = true;
    mode3dBtn.classList.add('active');
    modePlayBtn.classList.remove('active');
    updateTransform();
  });

  toggleLabelsBtn.addEventListener('click', () => {
    showLabels = !showLabels;
    toggleLabelsBtn.classList.toggle('active', showLabels);
    updateTransform();
  });

  gapSlider.addEventListener('input', (e) => {
    gap = Number(e.target.value) || 12;
    if (!exploded) mode3dBtn.click();
    else updateTransform();
  });

  let dragging = false, sx = 0, sy = 0;
  viewportEl.addEventListener('pointerdown', (e) => {
    if (!exploded) return;
    dragging = true; sx = e.clientX; sy = e.clientY;
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging || !exploded) return;
    rotY += (e.clientX - sx) * 0.35;
    rotX = Math.max(-55, Math.min(55, rotX - (e.clientY - sy) * 0.35));
    sx = e.clientX; sy = e.clientY;
    updateTransform();
  });
  window.addEventListener('pointerup', () => { dragging = false; });
  window.addEventListener('resize', updateTransform);
  render();
</script>
</body>
</html>`
}
