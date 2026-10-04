import { describe, expect, it } from 'vitest'
import {
  YOLO_CATALOG,
  YOLO_CATALOG_ALL,
  YOLO_CATALOG_SCALE_COUNT,
  YOLO_FACE_CATALOG,
  YOLO_FACE_CATALOG_BASE_URL,
  yoloFaceCatalogReady
} from '../src/shared/yoloCatalog'
import { isAllowedYoloDownloadUrl } from '../src/shared/yoloDownload'
import { YOLO_FACE_DETECT_MODEL_ID, YOLO_FACE_LANDMARK_MODEL_ID } from '../src/shared/yolo'

/**
 * 人脸两段式模型的**下载源契约**。
 *
 * 这组用例锁的是「换个 tag / 换个仓就不会悄悄坏」的那几件事：
 * 1. 两个模型必须成对出现在目录里，id 与文件名要和主进程 `pickFaceModel` 的约定名一致
 *    （错了不会报错，只会推理时维度不符、静默降级成空脸）；
 * 2. 地址必须落在白名单主机上，否则主进程会把自己的下载请求拦掉；
 * 3. `minBytes` 必须按条目给值 —— 人脸检测器只有几百 KB，写死 1MB 会把正常文件误判成
 *    「截断」；
 * 4. `sha256` 一旦填上必须是 64 位小写十六进制（校验逻辑按小写比较）。
 */

describe('人脸模型下载目录', () => {
  it('两个约定模型成对存在，id / 文件名与主进程口径一致', () => {
    expect(YOLO_FACE_CATALOG).toHaveLength(2)
    const ids = YOLO_FACE_CATALOG.map((m) => m.id)
    expect(ids).toEqual([YOLO_FACE_DETECT_MODEL_ID, YOLO_FACE_LANDMARK_MODEL_ID])
    for (const model of YOLO_FACE_CATALOG) {
      expect(model.kind).toBe('face')
      // 文件名即 id：模型目录扫描与 pickFaceModel 都按这个约定认
      expect(model.fileName).toBe(`${model.id}.onnx`)
    }
  })

  it('地址与 base url 对齐，且落在下载白名单主机上', () => {
    expect(YOLO_FACE_CATALOG_BASE_URL).toMatch(/^https:\/\//)
    for (const model of YOLO_FACE_CATALOG) {
      expect(model.url.startsWith(`${YOLO_FACE_CATALOG_BASE_URL}/`)).toBe(true)
      expect(model.url.endsWith(`/${model.fileName}`)).toBe(true)
      // 主进程会按白名单校验渲染层传下来的地址：源本身必须过得了这道门
      expect(isAllowedYoloDownloadUrl(model.url), model.url).toBe(true)
    }
    // 当前配置指向本仓 Release 的固定 tag
    expect(YOLO_FACE_CATALOG_BASE_URL).toContain('github.com/')
    expect(YOLO_FACE_CATALOG_BASE_URL).toContain('/releases/download/face-models-v1')
    expect(yoloFaceCatalogReady()).toBe(true)
  })

  it('完整性下限按条目给值（人脸模型比 YOLO 小得多，不能被 1MB 门槛误杀）', () => {
    for (const model of YOLO_FACE_CATALOG) {
      expect(model.minBytes, `${model.id} 缺 minBytes`).toBeGreaterThan(0)
      expect(model.minBytes).toBeLessThan(1024 * 1024)
    }
    // Ultralytics 那批保持 1MB 门槛
    for (const model of YOLO_CATALOG) {
      expect(model.minBytes).toBe(1024 * 1024)
    }
  })

  it('sha256 留空表示暂不校验；填了就必须是 64 位小写十六进制', () => {
    for (const model of YOLO_FACE_CATALOG) {
      if (model.sha256 === undefined) continue
      expect(model.sha256, `${model.id} 的 sha256 形状不对`).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('总目录 = Ultralytics 十二档 + 人脸两段式，id 不重复', () => {
    expect(YOLO_CATALOG).toHaveLength(12)
    expect(YOLO_CATALOG_SCALE_COUNT).toBe(4)
    expect(YOLO_CATALOG_ALL).toHaveLength(14)
    const ids = YOLO_CATALOG_ALL.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('模型下载地址白名单', () => {
  it('放行自家 Release 与 GitHub 资产重定向域名', () => {
    for (const url of [
      'https://github.com/Justin-sky/ai-art-engine/releases/download/face-models-v1/face-detect.onnx',
      'https://objects.githubusercontent.com/github-production-release-asset/x/y',
      'https://release-assets.githubusercontent.com/github-production-release-asset/x/y',
      'https://codeload.github.com/Justin-sky/ai-art-engine/zip/refs/tags/face-models-v1'
    ]) {
      expect(isAllowedYoloDownloadUrl(url), url).toBe(true)
    }
  })

  it('拒绝非 https、非白名单主机与畸形地址', () => {
    for (const url of [
      'http://github.com/a/b',
      'https://evil.example.com/face-detect.onnx',
      'https://github.com.evil.example.com/x.onnx',
      'file:///C:/models/face-detect.onnx',
      'ftp://github.com/x',
      'not a url',
      ''
    ]) {
      expect(isAllowedYoloDownloadUrl(url), url).toBe(false)
    }
  })
})
