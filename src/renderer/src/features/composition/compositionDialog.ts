import { reactive, readonly } from 'vue'
import type { VisionDetectedObject } from '@shared/visionTags'

/**
 * 智能构图对话框状态。
 * 主体数据直接取资产旁挂的 `asset.visionTags.objects`（入库时已本地 YOLO 打标，
 * 原图像素系人物框），打开时无需再次推理。
 */
export type ComposerDialogState = {
  open: boolean
  /** 来源资产 id（保存后用于提示；可为空） */
  assetId: string
  /** 资产名称，作为构图产物文件名主干 */
  name: string
  /** 可直接给 <img> / canvas 使用的源图地址 */
  url: string
  /** 工程内相对路径；png/jpeg 时交给主进程解码（备用，本对话框直接用 url） */
  relativePath: string
  /** 打标时的被检图像素宽高（与 persons 同坐标系；缺失时用 0 表示未知） */
  imageWidth: number
  imageHeight: number
  /** 人物主体候选框（label === 'person'，置信度降序） */
  persons: VisionDetectedObject[]
  /** 是否已有完整可用的打标数据（status ok 且带 objects/尺寸） */
  tagged: boolean
}

const state = reactive<ComposerDialogState>({
  open: false,
  assetId: '',
  name: '',
  url: '',
  relativePath: '',
  imageWidth: 0,
  imageHeight: 0,
  persons: [],
  tagged: false
})

export const composerDialogState = readonly(state)

export function openComposerDialog(payload: {
  url: string
  name?: string | null
  relativePath?: string | null
  assetId?: string | null
  imageWidth?: number | null
  imageHeight?: number | null
  persons?: VisionDetectedObject[]
  tagged?: boolean | null
}): void {
  state.url = payload.url?.trim() || ''
  state.name = payload.name?.trim() || ''
  state.relativePath = payload.relativePath?.trim() || ''
  state.assetId = payload.assetId?.trim() || ''
  state.imageWidth = Math.max(0, Math.floor(payload.imageWidth ?? 0))
  state.imageHeight = Math.max(0, Math.floor(payload.imageHeight ?? 0))
  state.persons = Array.isArray(payload.persons) ? payload.persons : []
  state.tagged = Boolean(payload.tagged)
  state.open = true
}

export function closeComposerDialog(): void {
  state.open = false
  state.url = ''
  state.name = ''
  state.relativePath = ''
  state.assetId = ''
  state.imageWidth = 0
  state.imageHeight = 0
  state.persons = []
  state.tagged = false
}
