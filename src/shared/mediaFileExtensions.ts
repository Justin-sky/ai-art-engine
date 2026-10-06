/**
 * 各类资产的**文件扩展名清单单一来源**。
 *
 * 为什么要收在一处：这些清单原先散在渲染层各处各写一份，于是同一个文件格式
 * 在不同入口被当成不同东西 —— 已经出过两次：
 *
 * 1. 对话产物卡只认 `['glb','gltf']`，**泼溅（`.ply` / `.spz`）落成纯文本路径**，
 *    明明 `ModelPreview` 能渲染它（见 `features/media/chatPreviewKind.ts`）
 * 2. 资产编辑器的文件选择器里**没有模型格式**（`model` 落到 `default` 分支）
 *
 * 所以这里收一份；`splatMesh.SPLAT_EXTENSIONS` 仍是泼溅扩展名本身的来源，
 * 本模块只负责「哪些扩展名属于哪类资产」。
 */

/**
 * 高斯泼溅（Gaussian Splatting）扩展名（**带点**，与 `splatMesh` 原有写法一致）。
 *
 * 放在 shared 而不是渲染层：`outputScan`（扫盘出卡）也要用它决定「同一批里谁当代表」，
 * 而它不能引 three.js。渲染层的 `splatMesh` 从这里 re-export，保持单一来源。
 */
export const SPLAT_EXTENSIONS = ['.ply', '.spz'] as const

/** 3D 模型类：网格（可进 DCC 的 fbx 也算）+ 高斯泼溅（Spark 渲染） */
export const MODEL_FILE_EXTENSIONS = ['glb', 'gltf', 'fbx', 'ply', 'spz'] as const

/** 图片（含矢量与动图） */
export const IMAGE_FILE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'] as const

/** 视频 */
export const VIDEO_FILE_EXTENSIONS = ['mp4', 'mov', 'webm', 'mkv', 'm4v'] as const

/** 声音 */
export const AUDIO_FILE_EXTENSIONS = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'] as const

/**
 * 视频 / 动作资产的拣选扩展名。
 *
 * 含 `glb` / `gltf` / 图片，因为动作可以由「3D 模型 + 站位图」配合产生 ——
 * 这是既有行为，不要因为「看起来不像视频」而删掉。
 */
export const MOTION_FILE_EXTENSIONS = [
  ...VIDEO_FILE_EXTENSIONS,
  'glb',
  'gltf',
  'png',
  'jpg'
] as const

/** 兜底「全部」：跨类型混选时的宽松集合 */
export const ANY_FILE_EXTENSIONS = ['png', 'jpg', 'mp4', 'mp3', 'txt', 'md'] as const

/** 3D 模型资产可拣选的文件格式（泼溅也算模型：它登记的就是 `model` 资产） */
export function modelFileExtensions(): string[] {
  return [...MODEL_FILE_EXTENSIONS]
}
