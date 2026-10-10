/**
 * 本地视觉权重的用户目录布局。
 *
 * `<userData>/local-models/`（或设置里覆盖的目录）下按家族分子目录：
 * - `yolo/`：检测、分割、姿态
 * - `face/`：人脸检测器与 FaceMesh
 * - `sam2/`：SAM 2.1 的 encoder 与 decoder
 *
 * 安装包里的 `resources/yolo-models` 与 `resources/face-models` 仍是随包源，
 * 首次启动再复制进上面的子目录。
 */
export const LOCAL_MODELS_DIR_NAME = 'local-models'

/** 7.x 及更早版本把 YOLO 与人脸 ONNX 平铺在这个目录。 */
export const LEGACY_LOCAL_MODELS_DIR_NAME = 'yolo-models'

export const YOLO_MODEL_SUBDIR = 'yolo'
export const FACE_MODEL_SUBDIR = 'face'
export const SAM2_MODEL_SUBDIR = 'sam2'

/** 根目录上散落的 .onnx 该进哪个子目录。非 onnx 返回 null。 */
export function looseOnnxBucket(fileName: string): 'yolo' | 'face' | null {
  if (!fileName.toLowerCase().endsWith('.onnx')) return null
  const id = fileName.slice(0, -'.onnx'.length)
  return id.toLowerCase().includes('face') ? 'face' : 'yolo'
}
