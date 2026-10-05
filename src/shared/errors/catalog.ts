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
  capabilitySvgRender: defErrSimple(
    'graphExec.capability.svgRender',
    'SVG 逐帧烘焙能力未注入',
    'SVG frame render capability not injected'
  ),
  capabilityImageGenerate: defErrSimple(
    'graphExec.capability.imageGenerate',
    '未注入图片生成能力，无法调用图片模型',
    'Image generation capability not injected; cannot call the image model'
  ),
  /** 图片裁剪（编辑器 compose）失败 */
  imageCropEmpty: defErrSimple('graphExec.imageCrop.empty', '裁剪失败', 'Image crop failed'),
  imageTransformEmpty: defErrSimple(
    'graphExec.imageTransform.empty',
    '图片变换失败',
    'Image transform failed'
  ),
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
  gridSplitEmpty: defErrSimple('graphExec.gridSplit.empty', '宫格切分失败', 'Grid split failed'),
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
  /** SVG 烘焙：输入不是可读的 SVG（缺源文件、或端口给的是位图） */
  svgSourceUnreadable: defErrSimple(
    'graphExec.svgAnim.sourceUnreadable',
    '读不到 SVG 源内容：请把图库里的 SVG 资产接到此节点',
    'Cannot read the SVG source: connect an SVG asset from the library'
  ),
  /** SVG 生成：模型输出里没有可用的 <svg> 标记 */
  svgGenEmpty: defErrSimple(
    'graphExec.svgGen.empty',
    '模型没有返回可用的 SVG 源码',
    'The model returned no usable SVG source'
  ),
  /** 可玩 HTML：模型输出抽不出 HTML */
  gameHtmlExtractFailed: defErrSimple(
    'graphExec.gameHtml.extractFailed',
    '模型没有返回可用的 HTML（需要完整 HTML 或带 canvas/script 的代码块）',
    'The model returned no usable HTML (need a full HTML document or a canvas/script fence)'
  ),
  /** 可玩 HTML：结构校验失败 */
  gameHtmlInvalid: defErr(
    'graphExec.gameHtml.invalid',
    (p: { reason: string }) => `可玩 HTML 校验失败：${p.reason}`,
    (p: { reason: string }) => `Playable HTML validation failed: ${p.reason}`
  ),
  /** SVG 烘焙：烘焙未产出画面 */
  svgRenderEmpty: defErrSimple(
    'graphExec.svgAnim.renderEmpty',
    'SVG 逐帧烘焙未产出画面',
    'SVG frame rendering produced no image'
  ),
  /** 语音合成：主进程未返回资产条目 */
  ttsNoAsset: defErrSimple(
    'graphExec.tts.noAsset',
    '语音合成未返回资产',
    'Speech synthesis returned no asset'
  ),
  /** 多说话人对话：对话稿解析后没有任何有效台词 */
  dialogueEmpty: defErrSimple(
    'graphExec.dialogue.empty',
    '对话稿是空的：每行写成「说话人: 台词」（如「A: 你终于来了。」）',
    'The dialogue script is empty: write one line per utterance as "Speaker: line"'
  ),
  /**
   * 音效节点缺音效能力。
   *
   * 这里必须**明确失败**：早先的实现是静默退回声音节点（TTS），
   * 结果把音效描述「念」了一遍 —— 产出的是语音而不是音效，用户还以为成功了。
   */
  soundEffectUnsupported: defErrSimple(
    'graphExec.soundEffect.unsupported',
    '当前执行环境没有音效生成能力：请确认已配置 ElevenLabs 提供商（音效走 /v1/sound-generation）',
    'Sound effect generation is unavailable in this run: configure an ElevenLabs provider (sound effects use /v1/sound-generation)'
  ),
  /** 音乐节点缺音乐能力（同上：明确失败，不换成别的生成能力） */
  musicUnsupported: defErrSimple(
    'graphExec.music.unsupported',
    '当前执行环境没有音乐生成能力：请在设置里配置 MiniMax / 通义千问（百炼 Fun-Music）/ ElevenLabs，并在「音乐」页签勾选音乐模型',
    'Music generation is unavailable in this run: configure a MiniMax / DashScope (Bailian Fun-Music) / ElevenLabs provider and select a music model on the Music tab in Settings'
  ),
  /** 音乐节点：没写编曲描述 */
  musicNoPrompt: defErrSimple(
    'graphExec.music.noPrompt',
    '音乐生成需要描述（风格 / 情绪 / 场景，如「轻快明亮的电子配乐，适合 Vlog 背景」）',
    'Music generation needs a description (style / mood / scene, e.g. "bright upbeat electronic bed for a vlog")'
  ),
  /** 多说话人对话：某几段没能确定音色（说话人没绑定音色，节点也没设默认音色） */
  dialogueVoiceMissing: defErr<{ lines: string; speakers: string }>(
    'graphExec.dialogue.voiceMissing',
    ({ lines, speakers }) =>
      `对话第 ${lines} 段缺少音色：请为说话人「${speakers}」在节点指令面板里绑定音色，或给节点设置一个默认音色`,
    ({ lines, speakers }) =>
      `Dialogue lines ${lines} have no voice: bind a voice for speaker "${speakers}" in the node instruction panel, or set a default voice on the node`
  ),
  /** GraphPlan 解析（parseGraphPlanJson） */
  planInvalidJson: defErrSimple(
    'graphPlan.invalidJson',
    '模型未返回合法 JSON',
    'The model returned no valid JSON'
  ),
  planNotObject: defErrSimple(
    'graphPlan.notObject',
    'GraphPlan 必须是对象',
    'GraphPlan must be an object'
  ),
  planNodesNotArray: defErrSimple(
    'graphPlan.nodesNotArray',
    'GraphPlan.nodes 必须是数组',
    'GraphPlan.nodes must be an array'
  ),
  planEdgesNotArray: defErrSimple(
    'graphPlan.edgesNotArray',
    'GraphPlan.edges 必须是数组',
    'GraphPlan.edges must be an array'
  ),
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
