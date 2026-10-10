import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateLocalModelLayout } from '../src/main/yolo/localModelMigrate'

const dirs: string[] = []

afterEach(async () => {
  const { rm } = await import('fs/promises')
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'local-models-'))
  dirs.push(dir)
  return dir
}

describe('本地模型目录迁移', () => {
  it('把旧的平面目录收进 yolo、face、sam2', async () => {
    const userData = await tempDir()
    const legacy = join(userData, 'yolo-models')
    await mkdir(join(legacy, 'sam2'), { recursive: true })
    await writeFile(join(legacy, 'yolo11n.onnx'), 'yolo')
    await writeFile(join(legacy, 'face-detect.onnx'), 'face')
    await writeFile(join(legacy, 'sam2', 'sam2.1_hiera_tiny.encoder.onnx'), 'enc')
    await writeFile(join(legacy, '.bundled-models.json'), JSON.stringify(['yolo11n.onnx']))

    const root = join(userData, 'local-models')
    migrateLocalModelLayout(userData, root)

    expect(await readFile(join(root, 'yolo', 'yolo11n.onnx'), 'utf8')).toBe('yolo')
    expect(await readFile(join(root, 'face', 'face-detect.onnx'), 'utf8')).toBe('face')
    expect(await readFile(join(root, 'sam2', 'sam2.1_hiera_tiny.encoder.onnx'), 'utf8')).toBe('enc')
    expect(JSON.parse(await readFile(join(root, '.bundled-models.json'), 'utf8'))).toEqual([
      'yolo11n.onnx'
    ])
    await expect(readdir(legacy)).rejects.toThrow()
  })

  it('自定义目录仍是旧路径时，就地拆进子目录且不覆盖已有文件', async () => {
    const userData = await tempDir()
    const root = join(userData, 'yolo-models')
    await mkdir(join(root, 'yolo'), { recursive: true })
    await writeFile(join(root, 'yolo11n.onnx'), 'loose')
    await writeFile(join(root, 'yolo', 'yolo11n.onnx'), 'kept')
    await writeFile(join(root, 'face-landmark.onnx'), 'mesh')

    migrateLocalModelLayout(userData, root)

    expect(await readFile(join(root, 'yolo', 'yolo11n.onnx'), 'utf8')).toBe('kept')
    expect(await readFile(join(root, 'yolo11n.onnx'), 'utf8')).toBe('loose')
    expect(await readFile(join(root, 'face', 'face-landmark.onnx'), 'utf8')).toBe('mesh')
  })
})
