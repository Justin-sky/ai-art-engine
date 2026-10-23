/**
 * 图片生成节点「透明背景」本地纯色底键控合成：
 * - 四边采样 + 连通域泛洪键控（保留主体内部同色高光/白眼珠，不挖内洞）；
 * - 封闭背景内洞自动穿透（punchInteriorBackgroundHoles，清除叉腰/双腿间/环形镂空的残留底色）；
 * - 引导图像滤波边缘精修（refineCutoutAlphaGuided）+ 八方向反混合去白边/黑边光晕（applyAssetQcFringeFix）；
 * - 返回 PNG dataUrl 与被抠除比例 keyedRatio（若纯色底不明显，执行层可继续回退高精抠图/YOLO分割）。
 */
import { applyAssetQcFringeFix, applyBorderFloodColorKey } from '@shared/gameAssets'
import {
  applyAlphaToRgba,
  punchInteriorBackgroundHoles,
  refineCutoutAlphaGuided
} from '@shared/yoloCutout'
import { loadImageElement } from '../../yolo/cutout'

export async function removeImageSolidBackground(input: {
  dataUrl: string
}): Promise<{ dataUrl: string; width: number; height: number; keyedRatio: number }> {
  const img = await loadImageElement(input.dataUrl)
  const sw = img.naturalWidth || img.width || 1
  const sh = img.naturalHeight || img.height || 1

  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    return { dataUrl: input.dataUrl, width: sw, height: sh, keyedRatio: 0 }
  }
  ctx.drawImage(img, 0, 0, sw, sh)
  const imageData = ctx.getImageData(0, 0, sw, sh)

  const res = applyBorderFloodColorKey(imageData.data, sw, sh, {
    distance: 40,
    feather: 34,
    soft: true
  })

  if (res.keyedRatio < 0.02) {
    return { dataUrl: input.dataUrl, width: sw, height: sh, keyedRatio: res.keyedRatio }
  }

  // 提取泛洪后的 alpha 平面，执行封闭背景内洞穿透与引导滤波亚像素边缘精修
  const total = sw * sh
  let alpha: Float32Array = new Float32Array(total)
  for (let i = 0; i < total; i++) {
    alpha[i] = imageData.data[i * 4 + 3]! / 255
  }
  alpha = punchInteriorBackgroundHoles(imageData.data, alpha, sw, sh)
  alpha = refineCutoutAlphaGuided(imageData.data, alpha, sw, sh, {
    radius: 1,
    colorMattingStrength: 0.35
  })
  applyAlphaToRgba(imageData.data, alpha)

  applyAssetQcFringeFix({ data: imageData.data, width: sw, height: sh })
  ctx.putImageData(imageData, 0, 0)

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: sw,
    height: sh,
    keyedRatio: res.keyedRatio
  }
}
