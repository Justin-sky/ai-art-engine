import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { IpcChannels } from '../src/shared/ipc'
import { YOLO_FACE_DETECT_MODEL_ID, YOLO_FACE_LANDMARK_MODEL_ID } from '../src/shared/yolo'
import { YOLO_KIND_ORDER } from '../src/shared/yoloCatalog'

/**
 * 人脸关键点（`face`）能力缝的接线完整性（源码文本断言）。
 *
 * 为什么用文本断言：这条链横跨 7 个文件（worker 分支 → service 方法 → IPC 通道 →
 * preload → 渲染层 api → portraitBake → 设置面板），而它**默认是静默降级**的 ——
 * 缺任何一环的表现都是 `detectPortraitFaces` 走到 catch 返回 `[]`（等于「没检出人脸」），
 * 不报错、不崩溃，只是五官 / 妆容 / 证件照裁切整组不生效。历史上
 * `EditorDiveNodeToolHost` 的 `toolOpen` 就是这样静默坏掉的（见 portraitDiveWiring）。
 *
 * 这些断言锁的是「接线没被删」而不是具体实现，改动实现时同步改断言即可。
 */

const ROOT = join(__dirname, '..')
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8')

/** preload 里的薄壳调用行（文本断言用，避免在断言里写超长正则字面量） */
const PRELOAD_INVOKE = 'yoloFace: (input) => ipcRenderer.invoke(IpcChannels.YOLO_FACE, input)'
const SHARED_API = 'yoloFace: (input: YoloInferenceInput) => Promise<YoloFaceResult>'
const SERVICE_FACE = 'async face(input: YoloInferenceInput): Promise<YoloFaceResult>'
const RENDERER_API = 'export function yoloFace(input: YoloInferenceInput): Promise<YoloFaceResult>'
const DETECT_FACES = 'export async function detectPortraitFaces(input: {'

describe('face 任务类型接线（worker → service → IPC → 渲染层）', () => {
  it('共享契约里有 face 的通道与两个约定模型 id', () => {
    expect(IpcChannels.YOLO_FACE).toBe('yolo:face')
    expect(YOLO_FACE_DETECT_MODEL_ID).toBe('face-detect')
    expect(YOLO_FACE_LANDMARK_MODEL_ID).toBe('face-landmark')
    // face 走另一套来源的两段式命名，不在 Ultralytics 下载目录的展示顺序里
    expect(YOLO_KIND_ORDER as readonly string[]).not.toContain('face')
  })

  it('StudioApi 声明了 yoloFace（preload 漏实现会被 vue-tsc 挡住）', () => {
    expect(read('src/shared/ipc.ts')).toContain(SHARED_API)
  })

  it('worker 把 face 方法分发给 inferFaces，并在退出时回收人脸会话', () => {
    const source = read('src/main/yolo/yoloWorker.ts')
    expect(source).toContain("import { disposeFaceSessions, inferFaces } from './faceInfer'")
    expect(source).toMatch(/case 'face':\s*\n\s*result = await runFace\(/)
    expect(source).toMatch(/return inferFaces\(loadOrt\(\), params\)/)
    expect(source).toContain('disposeFaceSessions()')
  })

  it('protocol 的 face 参数是两个模型路径', () => {
    const source = read('src/main/yolo/protocol.ts')
    expect(source).toMatch(/'ping' \| 'status' \| 'infer' \| 'face'/)
    const params = /interface YoloWorkerFaceParams[\s\S]*?\n\}/
    expect(source).toMatch(params)
    const faceParams = source.match(params)?.[0] ?? ''
    expect(faceParams).toContain('detectorPath: string')
    expect(faceParams).toContain('landmarkPath: string')
  })

  it('service 有 face() 并解析两段式路径、kindOfModelId 认得出人脸模型', () => {
    const source = read('src/main/yolo/yoloService.ts')
    expect(source).toContain(SERVICE_FACE)
    // 挑选规则抽到 @shared/yoloFaceModels 纯函数（有单测：tests/yoloFaceModels.test.ts），
    // service 只负责「挑不到时报清楚缺哪个角色」+ 下发 worker
    expect(source).toContain("from '@shared/yoloFaceModels'")
    expect(source).toContain('pickFaceModel({')
    expect(source).toContain('this.requireFaceModel(')
    expect(source).toMatch(/pickFaceModel\(\{[\s\S]{0,200}role: 'landmark'/)
    expect(source).toMatch(/excludePath: landmark\.model\?\.path/)
    expect(source).toMatch(/this\.call\('face', params, YOLO_INFER_TIMEOUT_MS\)/)
    // 文件名约定：检测器 + FaceMesh 的常量来自 @shared/yolo（经 yoloFaceModels），
    // 而不是散落的字面量
    expect(read('src/shared/yoloFaceModels.ts')).toContain('YOLO_FACE_DETECT_MODEL_ID')
    expect(read('src/shared/yoloFaceModels.ts')).toContain('YOLO_FACE_LANDMARK_MODEL_ID')
    expect(source).toMatch(/if \(lower\.includes\('face'\)\) return 'face'/)
  })

  it('IPC 三层都接上：main handler / preload invoke / 渲染层薄壳', () => {
    expect(read('src/main/ipc.ts')).toMatch(/IpcChannels\.YOLO_FACE, \(input: YoloInferenceInput\)/)
    expect(read('src/main/ipc.ts')).toContain('yoloService.face(input)')
    expect(read('src/preload/index.ts')).toContain(PRELOAD_INVOKE)
    const api = read('src/renderer/src/features/yolo/api.ts')
    expect(api).toContain(RENDERER_API)
    expect(api).toContain('return window.studio.yoloFace(input)')
  })

  it('detectPortraitFaces 真的调用 yoloFace 并把结果转成 canonical68（失败仍返回 []）', () => {
    const source = read('src/renderer/src/features/graph/model/portraitCapabilities.ts')
    // 同一个能力缝模块里还要用 yoloSegment 做人物蒙版：两个入口都从 yolo/api 走
    expect(source).toMatch(/import \{[^}]*yoloFace[^}]*\} from '\.\.\/\.\.\/yolo\/api'/)
    expect(source).toMatch(/import \{[^}]*yoloSegment[^}]*\} from '\.\.\/\.\.\/yolo\/api'/)
    expect(source).toContain(DETECT_FACES)
    expect(source).toContain("await yoloFace({ image: { kind: 'dataUrl', dataUrl: raw } })")
    expect(source).toContain("schema: 'canonical68' as const")
    expect(source).toContain('portraitFaceBoxFromLandmarks(landmarks)')
    // 归一化口径：除以推理结果的宽高，而不是像素原值
    expect(source).toMatch(/point\.x \/ width[\s\S]{0,120}point\.y \/ height/)
    // 面积从大到小：多人照下游默认取最大脸
    expect(source).toContain('portraitFaceArea(b) - portraitFaceArea(a)')
    // 降级：catch 里返回空数组（不抛错，不让整次出图失败）
    expect(source).toMatch(/catch \(err\) \{[\s\S]*?return \[\]/)
  })

  it('设置面板与两套文案都有人脸关键点档位（档位来自下载目录，源可配置）', () => {
    const panel = read('src/renderer/src/components/settings/YoloModelsPanel.vue')
    // 人脸档位不再写死预设，直接复用目录里 kind === 'face' 的条目
    expect(panel).toContain("catalogByKind('face')")
    expect(panel).toContain('yoloFaceCatalogReady')
    expect(panel).toContain('startDownload(model)')
    expect(panel).toContain("t('settings.yoloModels.facePresetHint')")
    for (const locale of ['zh-CN', 'en-US']) {
      const source = read(`src/renderer/src/i18n/locales/${locale}.ts`)
      expect(source, `${locale} 缺少 facePresetHint`).toContain('facePresetHint:')
      expect(source, `${locale} 缺少 faceSourceMissing`).toContain('faceSourceMissing:')
      expect(source, `${locale} 缺少 faceSourcePending`).toContain('faceSourcePending:')
      expect(source, `${locale} 缺少 kind.face`).toMatch(/face: '(人脸关键点|Face landmarks)'/)
    }
  })

  it('人脸模型有独立下载源（本仓 Release），并随包内置', () => {
    const catalog = read('src/shared/yoloCatalog.ts')
    // 两个约定模型在**独立**目录里，地址指向本仓 Release
    expect(catalog).toContain('face-detect')
    expect(catalog).toContain('face-landmark')
    expect(catalog).toContain('YOLO_FACE_CATALOG_BASE_URL')
    // 随包内置清单存在（构建脚本与打包自检都按它走）
    expect(catalog).toContain('YOLO_FACE_BUNDLED_FILES')
    // Ultralytics 那批仍是 base url 拼出来的，人脸条目不能混进 RAW_ENTRIES
    const ultralytics = /const RAW_ENTRIES[\s\S]*?\n\]/.exec(catalog)?.[0] ?? ''
    expect(ultralytics).not.toContain('face')

    // 构建期抓取脚本要拉这两个模型到 resources/face-models（同一份 Release 资产）
    const fetchScript = read('scripts/fetch-yolo-models.mjs')
    expect(fetchScript).toContain('face-detect.onnx')
    expect(fetchScript).toContain('face-landmark.onnx')
    expect(fetchScript).toContain('face-models-v1')
    expect(fetchScript).toContain("'face-models'")

    // 打包前自检：两个目录各自要求文件，且逐文件给下限（人脸模型比 YOLO 小一个量级）
    const packCheck = read('scripts/check-pack-resources.mjs')
    for (const file of [
      'yolo11n.onnx',
      'yolo11n-seg.onnx',
      'yolo11n-pose.onnx',
      'face-detect.onnx',
      'face-landmark.onnx'
    ]) {
      expect(packCheck, `打包自检没有要求 ${file}`).toContain(file)
    }
    expect(packCheck).toContain("'face-models'")
    expect(packCheck).toMatch(/face-detect\.onnx', minBytes: 256 \* 1024/)

    // electron-builder 要把两个目录都作为 extraResources 分发
    const builder = read('electron-builder.yml')
    expect(builder).toContain('resources/yolo-models')
    expect(builder).toContain('resources/face-models')

    // 主进程要扫两个内置目录（否则内置了也不会进模型目录）
    const service = read('src/main/yolo/yoloService.ts')
    expect(service).toContain("'yolo-models'")
    expect(service).toContain("'face-models'")
  })
})
