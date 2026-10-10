/**
 * 关键帧 YOLO 检测 + 人脸检测 → ShotDetection[]，再交给 linkEntitiesFromDetections。
 */
import { existsSync } from 'fs'
import { join } from 'path'
import { yoloService } from '../../yolo/yoloService'
import {
  linkEntitiesFromDetections,
  type DetectBox,
  type Entity,
  type ShotDetection,
  type ShotEvidence
} from '@shared/semanticTimeline'

function resolveKeyframeAbs(
  projectRoot: string,
  timelineId: string,
  rel: string | undefined
): string | null {
  if (!rel) return null
  const abs = join(projectRoot, 'Semantic', timelineId, ...rel.split('/'))
  return existsSync(abs) ? abs : null
}

async function detectBoxesOnImage(
  abs: string
): Promise<{ boxes: DetectBox[]; width?: number; height?: number }> {
  const boxes: DetectBox[] = []
  let width: number | undefined
  let height: number | undefined
  try {
    const det = await yoloService.detect({ image: { kind: 'file', path: abs } })
    width = det.width
    height = det.height
    for (const b of det.boxes ?? []) {
      boxes.push({
        label: b.label,
        confidence: b.confidence,
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height
      })
    }
  } catch {
    /* 模型未就绪时降级为空 */
  }
  try {
    const face = await yoloService.face({ image: { kind: 'file', path: abs } })
    width ??= (face as { width?: number }).width
    height ??= (face as { height?: number }).height
    for (const f of face.faces ?? []) {
      const box = f.box
      if (!box) continue
      boxes.push({
        label: 'face',
        confidence: f.score ?? 0.7,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height
      })
    }
  } catch {
    /* 人脸模型可选 */
  }
  return { boxes, width, height }
}

/** 对每个镜头取中帧（缺省首帧）跑检测 */
export async function detectEntitiesForShots(
  projectRoot: string,
  timelineId: string,
  shots: ShotEvidence[],
  fps: number
): Promise<{ detections: ShotDetection[]; entities: Entity[] }> {
  const detections: ShotDetection[] = []
  for (const shot of shots) {
    const kf =
      resolveKeyframeAbs(projectRoot, timelineId, shot.keyframes?.middle) ??
      resolveKeyframeAbs(projectRoot, timelineId, shot.keyframes?.first)
    const det = kf ? await detectBoxesOnImage(kf) : { boxes: [] as DetectBox[] }
    detections.push({
      shotId: shot.id,
      range: shot.range,
      boxes: det.boxes,
      frameWidth: det.width,
      frameHeight: det.height
    })
  }
  const entities = linkEntitiesFromDetections(detections, { fps })
  return { detections, entities }
}
