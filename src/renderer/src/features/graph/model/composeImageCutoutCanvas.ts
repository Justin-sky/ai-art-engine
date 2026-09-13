/**
 * 节点图本地抠图合成（渲染层）：复用一键抠图对话框同款链路。
 *
 * analyzeCutout 完成 YOLO 分割并解码原图，renderCutoutPng 完成
 * 软边 alpha + 羽化 + 去光晕合成，产物即透明通道 PNG 的 dataUrl。
 */
import { normalizeImageCutout, type ImageCutoutState } from '@shared/graph'
import { analyzeCutout, renderCutoutPng } from '../../yolo/cutout'

export async function composeImageCutoutCanvas(input: {
  sourceDataUrl: string
  state: ImageCutoutState
}): Promise<{ dataUrl: string; width: number; height: number }> {
  const state = normalizeImageCutout(input.state)
  const { analysis, image } = await analyzeCutout({ url: input.sourceDataUrl }, state.confThreshold)

  // 优先使用抠图工具里用户勾选的实例；勾选失效（检测结果漂移）时回退默认规则
  const picked = (state.selected ?? []).filter((index) =>
    analysis.instances.some((it) => it.index === index)
  )
  let selected: number[]
  if (picked.length) {
    selected = picked
  } else if (state.personOnly) {
    selected = analysis.instances.filter((it) => it.label === 'person').map((it) => it.index)
  } else {
    selected = analysis.instances.map((it) => it.index)
  }
  if (!selected.length) {
    throw new Error('CUTOUT_NO_INSTANCES')
  }

  const out = await renderCutoutPng({
    image,
    analysis,
    selected,
    threshold: state.threshold,
    feather: state.feather,
    cropToSubject: state.cropToSubject
  })
  return {
    dataUrl: out.canvas.toDataURL('image/png'),
    width: out.width,
    height: out.height
  }
}
