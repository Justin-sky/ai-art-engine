import { defErr, defErrSimple } from './appError'

/**
 * src/shared/graph/execute 等渲染进程执行的共享代码错误条目。
 * 双进程共用（renderGraph 运行在 renderer），不能 import main 侧模块。
 * GRAPH_* 哨兵不在此列（保持裸字符串等值比较的控制流不变）。
 */
export const SHARED_ERRORS = {
  noModelImage: defErrSimple(
    'graphExec.noImageResult',
    '模型未返回图片',
    'The model returned no image'
  ),
  persistImageFailed: defErr<{ detail: string }>(
    'graphExec.persistImageFailed',
    ({ detail }) => `图片落盘失败${detail ? `: ${detail}` : ''}`,
    ({ detail }) => `Failed to save image to disk${detail ? `: ${detail}` : ''}`
  ),

  /* ── graph 执行层（Group P6）补充条目 ─────────────────────────────── */

  /** 「模型未返回X结果」家族：zh 侧统一句式 `模型未返回${what.zh}` */
  resultMissing: defErr<{ what: { zh: string; en: string } }>(
    'graphExec.modelMissingResult',
    ({ what }) => `模型未返回${what.zh}`,
    ({ what }) => `The model returned no ${what.en}`
  ),
  /** 图层分离：复用已有图层为空（结果无有效图层） */
  layerSplitEmpty: defErrSimple(
    'graphExec.layerSplit.empty',
    '图层分离失败：未得到有效图层',
    'Layer separation failed: no valid layers produced'
  ),
  /** 图层分离：当前模型不支持 / 未返回图层（提示切 Seedream 5.0 Pro） */
  layerSplitNoLayers: defErrSimple(
    'graphExec.layerSplit.noLayers',
    '当前模型未返回图层。请使用 Seedream 5.0 Pro 并开启图层分离',
    'The current model returned no layers. Use Seedream 5.0 Pro with layer separation enabled'
  ),
  /** 能力注入守卫：ctx 注入的画布能力缺失，不能继续执行 */
  capabilityGridCrop: defErrSimple(
    'graphExec.capability.gridCrop',
    '宫格裁切能力未注入，无法执行宫格切分',
    'Grid-cell compose capability not injected; cannot run grid split'
  ),
  capabilityFrameSplit: defErrSimple(
    'graphExec.capability.frameSplit',
    '帧序列切分能力未注入',
    'Frame sequence split capability not injected'
  ),
  capabilityImageGenerate: defErrSimple(
    'graphExec.capability.imageGenerate',
    '未注入图片生成能力，无法图层分离',
    'Image generation capability not injected; cannot run layer separation'
  ),
  /** 图片裁剪（编辑器 compose）失败 */
  imageCropEmpty: defErrSimple('graphExec.imageCrop.empty', '裁剪失败', 'Image crop failed'),
  /** 图层堆叠合成：无有效图层 / 缺少底图 */
  imageComposeNoLayers: defErrSimple(
    'graphExec.imageCompose.noLayers',
    '没有可合成的图层',
    'No layers to composite'
  ),
  imageComposeBaseMissing: defErrSimple(
    'graphExec.imageCompose.baseMissing',
    '缺少底图，无法合成图层',
    'Missing base image; cannot composite layers'
  ),
  /** 宫格切分单格裁切失败 */
  gridCellCropFailed: defErr<{ cell: string | number }>(
    'graphExec.gridSplit.cellCropFailed',
    ({ cell }) => `宫格 ${cell} 裁切失败`,
    ({ cell }) => `Failed to crop grid cell ${cell}`
  ),
  gridSplitEmpty: defErrSimple(
    'graphExec.gridSplit.empty',
    '宫格切分失败',
    'Grid split failed'
  ),
  /** 帧序列切分单帧失败 */
  frameCellSplitFailed: defErr<{ cell: string | number }>(
    'graphExec.frameSplit.cellSplitFailed',
    ({ cell }) => `帧 ${cell} 切分失败`,
    ({ cell }) => `Failed to split frame ${cell}`
  ),
  frameSplitEmpty: defErrSimple(
    'graphExec.frameSplit.empty',
    '帧序列切分失败',
    'Frame sequence split failed'
  ),
  /** 语音合成：主进程未返回资产条目 */
  ttsNoAsset: defErrSimple(
    'graphExec.tts.noAsset',
    '语音合成未返回资产',
    'Speech synthesis returned no asset'
  ),
  /** GraphPlan 解析（parseGraphPlanJson） */
  planInvalidJson: defErrSimple(
    'graphPlan.invalidJson',
    '模型未返回合法 JSON',
    'The model returned no valid JSON'
  ),
  planNotObject: defErrSimple('graphPlan.notObject', 'GraphPlan 必须是对象', 'GraphPlan must be an object'),
  planNodesNotArray: defErrSimple('graphPlan.nodesNotArray', 'GraphPlan.nodes 必须是数组', 'GraphPlan.nodes must be an array'),
  planEdgesNotArray: defErrSimple('graphPlan.edgesNotArray', 'GraphPlan.edges 必须是数组', 'GraphPlan.edges must be an array'),
  /** ComfyUI workflow 格式校验（uiToApi / injectWorkflow） */
  comfyuiNotUiFormat: defErrSimple(
    'comfyui.workflow.notUiFormat',
    '不是 ComfyUI UI 格式 workflow',
    'Not a ComfyUI UI-format workflow'
  ),
  comfyuiNoExecutableNodes: defErrSimple(
    'comfyui.workflow.noExecutableNodes',
    'UI workflow 转换后没有可执行节点',
    'Converted UI workflow has no executable nodes'
  ),
  comfyuiWorkflowNotObject: defErrSimple(
    'comfyui.workflow.notObject',
    'workflow 不是对象',
    'workflow must be an object'
  ),
  comfyuiUnrecognizedFormat: defErrSimple(
    'comfyui.workflow.unrecognizedApiFormat',
    '无法识别 ComfyUI API 格式 workflow',
    'Unable to recognize ComfyUI API-format workflow'
  ),
  /** 资产包 pathname 安全校验 */
  packagePathPrefix: defErr<{ path: string }>(
    'assetPackage.path.prefix',
    ({ path }) => `pathname 必须以 Assets/ 开头: ${path}`,
    ({ path }) => `Pathname must start with Assets/: ${path}`
  ),
  packagePathInvalid: defErr<{ path: string }>(
    'assetPackage.path.invalid',
    ({ path }) => `非法 pathname: ${path}`,
    ({ path }) => `Invalid pathname: ${path}`
  ),
  packagePathAbsolute: defErr<{ path: string }>(
    'assetPackage.path.absolute',
    ({ path }) => `pathname 不能是绝对路径: ${path}`,
    ({ path }) => `Pathname cannot be an absolute path: ${path}`
  ),
  packageFolderCycle: defErr<{ path: string }>(
    'assetPackage.path.folderCycle',
    ({ path }) => `文件夹环: ${path}`,
    ({ path }) => `Folder cycle detected: ${path}`
  )
}
