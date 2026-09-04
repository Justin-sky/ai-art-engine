/**
 * YOLO 本地视觉底座 — 跨 主进程 / preload / 渲染进程 共享的类型与常量。
 * 数据面协议（worker 内部）见 src/main/yolo/protocol.ts，本文件只定义对外契约。
 */

/** 推理任务类型：目标检测 / 实例分割 / 人体姿态估计 */
export type YoloTaskKind = 'detect' | 'segment' | 'pose'

/** 像素坐标系下的检测框（相对原图，未裁剪） */
export interface YoloBox {
  label: string
  confidence: number
  /** 左上角 x（原图像素） */
  x: number
  /** 左上角 y（原图像素） */
  y: number
  width: number
  height: number
}

export interface YoloSkeletonPoint {
  x: number
  y: number
  confidence: number
}

/** 目标检测结果 */
export interface YoloDetectResult {
  width: number
  height: number
  boxes: YoloBox[]
  inferenceMs: number
}

/** 实例分割结果：mask 与对应 box 等长，data 为 0/1 二值（mask 分辨率 160x160，待上层放大） */
export interface YoloSegmentResult extends YoloDetectResult {
  masks: Array<{ width: number; height: number; data: Uint8Array }>
}

/** 姿态估计结果：skeletons[i] 为 COCO 17 关键点 */
export interface YoloPoseResult extends YoloDetectResult {
  skeletons: YoloSkeletonPoint[][]
}

/**
 * 输入图像三种形态：
 * - file：本地绝对路径（主进程可解析相对工程根，见 YoloService.detect）
 * - dataUrl：data:image/png|jpeg;base64,...（纯 JS 解码 png/jpeg；webp 请走 raw）
 * - raw：渲染层 canvas 直出的 RGBA 像素（webp 等解码器不支持时的兜底）
 */
export type YoloImageInput =
  | { kind: 'file'; path: string }
  | { kind: 'dataUrl'; dataUrl: string }
  | { kind: 'raw'; width: number; height: number; rgba: Uint8Array }

/** 检测 / 分割 / 姿态统一入参 */
export interface YoloInferenceInput {
  image: YoloImageInput
  /** 指定模型（模型目录下的 .onnx 文件名）；缺省按任务类型自动选择 */
  modelId?: string
  /** NMS IoU 阈值，默认 0.45 */
  iouThreshold?: number
  /** 置信度阈值，默认 0.25 */
  confThreshold?: number
}

/** 模型目录中的一个可用模型 */
export interface YoloModelInfo {
  /** 文件名去扩展名，如 yolo11n / yolo11n-seg / yolo11n-pose */
  id: string
  kind: YoloTaskKind
  /** 绝对路径 */
  path: string
  sizeMb: number
}

/** 推理后端（预留：后续可加 'dml' 需安装 onnxruntime-directml） */
export type YoloBackend = 'cpu'

/** yolo:status 返回的整体状态 */
export interface YoloStatus {
  /** 推理进程存活且 onnxruntime 可加载 */
  ready: boolean
  ortVersion?: string
  backend: YoloBackend
  modelDir: string
  models: YoloModelInfo[]
  /** 未就绪原因（进程崩溃 / ort 缺失 / 无模型等） */
  error?: string
}

export const YOLO_DEFAULT_CONF = 0.25
export const YOLO_DEFAULT_IOU = 0.45
/** YOLOv8 / YOLO11 默认输入边长 */
export const YOLO_INPUT_SIZE = 640
/** letterbox 填充灰度值（YOLO 训练约定） */
export const YOLO_PAD_VALUE = 114
/** 推理请求超时（毫秒），CPU 大图保守给 120s */
export const YOLO_INFER_TIMEOUT_MS = 120_000

/** COCO 80 类标签（YOLOv8 / YOLO11 检测与分割共用） */
export const YOLO_COCO_LABELS: string[] = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
  'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat',
  'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack',
  'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball',
  'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket',
  'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
  'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair',
  'couch', 'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
  'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink',
  'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier',
  'toothbrush'
]

/** COCO 80 类中文名（与 YOLO_COCO_LABELS 顺序一一对应，素材打标/检索展示用） */
export const YOLO_COCO_LABELS_ZH: string[] = [
  '人物', '自行车', '汽车', '摩托车', '飞机', '公交车', '火车', '卡车', '船',
  '交通灯', '消防栓', '停车标志', '停车计时器', '长椅', '鸟', '猫',
  '狗', '马', '羊', '牛', '大象', '熊', '斑马', '长颈鹿', '背包',
  '雨伞', '手提包', '领带', '行李箱', '飞盘', '滑雪板', '单板', '球类',
  '风筝', '棒球棒', '棒球手套', '滑板', '冲浪板', '网球拍',
  '瓶子', '酒杯', '杯子', '叉子', '刀', '勺子', '碗', '香蕉', '苹果',
  '三明治', '橙子', '西兰花', '胡萝卜', '热狗', '披萨', '甜甜圈', '蛋糕', '椅子',
  '沙发', '盆栽', '床', '餐桌', '马桶', '电视', '笔记本电脑', '鼠标',
  '遥控器', '键盘', '手机', '微波炉', '烤箱', '烤面包机', '水槽',
  '冰箱', '书', '钟表', '花瓶', '剪刀', '泰迪熊', '吹风机',
  '牙刷'
]

/** COCO 英文标签 → 中文展示名；未知标签原样返回 */
export function cocoLabelZh(label: string): string {
  const index = YOLO_COCO_LABELS.indexOf(label)
  return index >= 0 && index < YOLO_COCO_LABELS_ZH.length ? YOLO_COCO_LABELS_ZH[index] : label
}

/** COCO 姿态 17 关键点名称（顺序与模型输出一致） */
export const YOLO_POSE_KEYPOINT_NAMES: string[] = [
  'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear', 'left_shoulder',
  'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist',
  'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle'
]
