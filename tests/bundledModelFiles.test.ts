import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 随包内置的本地视觉模型。
 *
 * 五份 `.onnx`（YOLO detect / segment / pose + 人脸 detect / landmark）**已随仓库提交**，
 * 本地与 CI 构建都不再联网抓取 —— 这条约定有三个会静默坏掉的点，所以在这里锁住：
 *
 * 1. **文件必须在库里**：被 `.gitignore` 挡在检出之外、或忘了 `git add -f` 时，全新 clone
 *    就没有模型，只能靠 `fetch:yolo-models` 兜（而它依赖外部可达）；
 * 2. **`.gitattributes` 必须把 `*.onnx` 标成 binary**：仓库有 `* text=auto eol=lf`，
 *    一旦 protobuf 被当文本做了行尾转换，字节就变了 —— 校验和对不上、安装包里的模型也损坏，
 *    而且**不会有任何报错**，只表现为推理结果变差；
 * 3. **人脸两个的字节必须与 `yoloCatalog` 钉死的 sha256 一致**：应用内兜底下载会校验它，
 *    本地文件与目录条目脱钩时，用户装完包才发现下载被拒。
 */

const ROOT = join(__dirname, '..')

const BUNDLED = [
  { path: 'resources/yolo-models/yolo11n.onnx', minBytes: 1024 * 1024 },
  { path: 'resources/yolo-models/yolo11n-seg.onnx', minBytes: 1024 * 1024 },
  { path: 'resources/yolo-models/yolo11n-pose.onnx', minBytes: 1024 * 1024 },
  { path: 'resources/face-models/face-detect.onnx', minBytes: 256 * 1024 },
  { path: 'resources/face-models/face-landmark.onnx', minBytes: 256 * 1024 }
]

function sha256(relative: string): string {
  return createHash('sha256')
    .update(readFileSync(join(ROOT, relative)))
    .digest('hex')
}

describe('随包内置模型（已入库，构建零下载）', () => {
  it('五份模型都在工作区里且体积达标', () => {
    for (const file of BUNDLED) {
      const abs = join(ROOT, file.path)
      expect(existsSync(abs), `${file.path} 不在仓库里（本地 / CI 构建会因此联网抓取）`).toBe(true)
      const size = statSync(abs).size
      expect(size, `${file.path} 只有 ${(size / 1024).toFixed(0)} KB`).toBeGreaterThanOrEqual(
        file.minBytes
      )
    }
  })

  it('.gitattributes 把 .onnx 标成 binary（否则行尾转换会悄悄改字节）', () => {
    const attributes = readFileSync(join(ROOT, '.gitattributes'), 'utf8')
    expect(attributes).toMatch(/^\*\.onnx binary$/m)
    // binary 宏必须在 `* text=auto` 之后：同一属性后出现的规则优先
    const textAuto = attributes.indexOf('* text=auto')
    const binary = attributes.indexOf('*.onnx binary')
    expect(textAuto).toBeGreaterThanOrEqual(0)
    expect(binary).toBeGreaterThan(textAuto)
  })

  it('人脸模型的字节与 yoloCatalog 钉死的 sha256 一致', () => {
    const catalog = readFileSync(join(ROOT, 'src/shared/yoloCatalog.ts'), 'utf8')
    // 目录条目里的 id 是模型 id 常量（不是字面量），按常量名配对
    const entries = [
      {
        file: 'resources/face-models/face-detect.onnx',
        idConst: 'YOLO_FACE_DETECT_MODEL_ID'
      },
      {
        file: 'resources/face-models/face-landmark.onnx',
        idConst: 'YOLO_FACE_LANDMARK_MODEL_ID'
      }
    ]
    for (const entry of entries) {
      const block = new RegExp(`id: ${entry.idConst},[\\s\\S]*?sha256: '([0-9a-f]{64})'`).exec(
        catalog
      )
      expect(block, `yoloCatalog 里找不到 ${entry.idConst} 的 sha256`).toBeTruthy()
      expect(sha256(entry.file), `${entry.file} 与 catalog 的 sha256 不一致`).toBe(block![1])
    }
  })
})
