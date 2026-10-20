import {
  DELIVERABLE_FILE_EXTENSIONS,
  HTML_FILE_EXTENSIONS,
  IMAGE_FILE_EXTENSIONS,
  MODEL_FILE_EXTENSIONS,
  VIDEO_FILE_EXTENSIONS
} from './mediaFileExtensions'

export interface ChatNextActionPill {
  id: string
  icon: string
  labelZh: string
  labelEn: string
  /** 点击后发送给 AI 助手的指令（或由前端直接触发本地动作） */
  promptZh: string
  promptEn: string
  /** 可选：前端可直接拦截执行的本地快捷动作（如打开图层工作台、用默认应用打开文件） */
  localAction?: 'open-default-app' | 'reveal-in-folder' | 'open-layer-split'
}

const IMAGE_SET = new Set<string>(IMAGE_FILE_EXTENSIONS)
const VIDEO_SET = new Set<string>(VIDEO_FILE_EXTENSIONS)
const MODEL_SET = new Set<string>(MODEL_FILE_EXTENSIONS)
const HTML_SET = new Set<string>(HTML_FILE_EXTENSIONS)
const DELIVERABLE_SET = new Set<string>(DELIVERABLE_FILE_EXTENSIONS)

function extOf(path: string): string {
  const clean = (path ?? '').split(/[?#]/)[0]?.trim() ?? ''
  const dot = clean.lastIndexOf('.')
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : ''
}

/**
 * 根据对话流中刚生成的产物路径（及同批次附件路径），推导 3~4 个最契合创作心流的「下一步追击胶囊」。
 */
export function resolveChatNextActions(
  primaryPath: string,
  relatedPaths: readonly string[] = []
): ChatNextActionPill[] {
  const allPaths = [primaryPath, ...relatedPaths].filter(Boolean)
  const primaryExt = extOf(primaryPath)
  const hasPsd = allPaths.some((p) => extOf(p) === 'psd')
  const isLayerSplitOutput = hasPsd || allPaths.some((p) => /layersplit|图层分离|拆分/i.test(p))

  if (primaryExt === 'psd' || isLayerSplitOutput) {
    return [
      {
        id: 'open-layer-workbench',
        icon: '🧊',
        labelZh: '3D 图层爆炸视图',
        labelEn: '3D Exploded Layer View',
        promptZh: '打开当前图层分离节点的全屏工作台预览 3D 图层结构',
        promptEn: 'Open the layer split workbench to inspect the 3D exploded layer stack',
        localAction: 'open-layer-split'
      },
      {
        id: 'open-psd-app',
        icon: '🗂️',
        labelZh: '用 Photoshop 打开 PSD',
        labelEn: 'Open PSD in Photoshop',
        promptZh: '',
        promptEn: '',
        localAction: 'open-default-app'
      },
      {
        id: 'upscale-ui-base',
        icon: '✨',
        labelZh: '2x 超清放大底图',
        labelEn: '2x Upscale Composite',
        promptZh: `在当前画布把刚生成的图层合成结果连入高清放大节点（image.upscale）并执行 2x 放大`,
        promptEn: `Wire the composite output into an image.upscale node on the active canvas and run a 2x upscale`
      },
      {
        id: 'animate-ui-screen',
        icon: '🎬',
        labelZh: '生成界面呼吸动效视频',
        labelEn: 'Animate UI Screen',
        promptZh: `在当前画布将这张界面图连入视频生成节点（asset.video），生成微光流转与悬浮呼吸感的动态 UI 展示视频并运行`,
        promptEn: `Wire this UI screen into an asset.video node on the active canvas to generate a subtle ambient UI motion video and run it`
      }
    ]
  }

  if (IMAGE_SET.has(primaryExt)) {
    return [
      {
        id: 'split-to-psd',
        icon: '🗂️',
        labelZh: '拆分为分层 PSD',
        labelEn: 'Split into Layered PSD',
        promptZh: `在当前画布将图片（${primaryPath}）连入图层分离节点（image.layerSplit），自动拆解透明图层并导出 PSD 文件`,
        promptEn: `On the active canvas, wire this image (${primaryPath}) into an image.layerSplit node to decompose transparent layers and export a PSD`
      },
      {
        id: 'upscale-2x',
        icon: '🔍',
        labelZh: '2x 超清放大',
        labelEn: '2x HD Upscale',
        promptZh: `在当前画布将该图片节点连入高清放大节点（image.upscale）并运行 2x 超分`,
        promptEn: `Wire this image node into an image.upscale node on the active canvas and run 2x super-resolution`
      },
      {
        id: 'relight-3d',
        icon: '💡',
        labelZh: '3D 棚拍重打光',
        labelEn: '3D Studio Relight',
        promptZh: `在当前画布将该图片连入智能打光节点（image.lighting），使用电影感轮廓光预设重打光并运行`,
        promptEn: `Wire this image into an image.lighting node on the active canvas with cinematic rim lighting and run it`
      },
      {
        id: 'image-to-video',
        icon: '🎬',
        labelZh: '让画面动起来',
        labelEn: 'Animate to Video',
        promptZh: `在当前画布将该图片作为首帧连入视频生成节点（asset.video），生成自然流畅的镜头运动视频并运行`,
        promptEn: `Wire this image as the first frame into an asset.video node on the active canvas and generate a smooth motion video`
      }
    ]
  }

  if (VIDEO_SET.has(primaryExt)) {
    return [
      {
        id: 'frame-pull-edit',
        icon: '🎞️',
        labelZh: '逐帧拉片与区间重拍',
        labelEn: 'Frame Pull & Reshoot',
        promptZh: `在当前画布将该视频连入逐帧拉片节点（video.framePull），抽取关键帧以便审片与局部重拍`,
        promptEn: `Wire this video into a video.framePull node on the active canvas to extract keyframes for review and局部 reshoot`
      },
      {
        id: 'lip-sync-voice',
        icon: '🔊',
        labelZh: '配音与口型同步',
        labelEn: 'Voiceover & Lip Sync',
        promptZh: `在当前画布新增配音生成节点（asset.voice）与口型同步节点（video.lipSync），为该视频配上贴合画面氛围的台词并驱动口型`,
        promptEn: `Add an asset.voice node and video.lipSync node on the active canvas to add voiceover and lip-sync to this video`
      }
    ]
  }

  if (MODEL_SET.has(primaryExt)) {
    return [
      {
        id: 'rig-and-animate',
        icon: '🦴',
        labelZh: '自动绑骨与待机动画',
        labelEn: 'Auto-Rig & Idle Animation',
        promptZh: `在当前画布将该 3D 模型连入骨骼蒙皮节点（model.rigSkin）与动作节点（model.animation），生成待机呼吸动画`,
        promptEn: `Wire this 3D model into model.rigSkin and model.animation on the active canvas to generate an idle animation`
      },
      {
        id: 'stage-director',
        icon: '🎥',
        labelZh: '送入 3D 导演舞台布光',
        labelEn: 'Send to 3D Director Stage',
        promptZh: `在当前画布将该 3D 模型连入 3D 导演台节点（scene.director）进行多机位运镜与舞台渲染`,
        promptEn: `Wire this 3D model into a scene.director node on the active canvas for multi-camera staging`
      }
    ]
  }

  if (HTML_SET.has(primaryExt) || DELIVERABLE_SET.has(primaryExt)) {
    return [
      {
        id: 'open-external',
        icon: '🚀',
        labelZh: '用外部工具打开',
        labelEn: 'Open in External App',
        promptZh: '',
        promptEn: '',
        localAction: 'open-default-app'
      },
      {
        id: 'reveal-folder',
        icon: '📂',
        labelZh: '在文件夹中显示',
        labelEn: 'Reveal in Folder',
        promptZh: '',
        promptEn: '',
        localAction: 'reveal-in-folder'
      }
    ]
  }

  return []
}
