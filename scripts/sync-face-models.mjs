/**
 * 把人脸关键点两段式模型（BlazeFace 检测器 + FaceMesh）同步到**本仓 GitHub Release**，
 * 并算出精确的 SHA-256 供 `@shared/yoloCatalog` 填表。
 *
 *   node scripts/sync-face-models.mjs --dir "C:\path\to\face-onnx"
 *   node scripts/sync-face-models.mjs --dir <dir> --tag face-models-v1
 *   node scripts/sync-face-models.mjs --dir <dir> --upload      # 用 gh CLI 建 release 并上传
 *
 * 为什么要有这个脚本：
 * 1. 这两个模型来自另一套上游，没有可长期固定的直链 —— 自托管到本仓 Release 后，
 *    catalog 里的 tag 才会长期有效（`face-models-v1`）；
 * 2. 落盘前的完整性校验需要**精确的 sha256**：一个字节的差异都意味着拿到的不是同一份
 *    权重（换成别的模型只会得到一张空脸，静默失败最难查）。本脚本打印可直接粘贴的
 *    代码片段，避免手抄 64 位十六进制。
 *
 * 文件命名即模型 id，必须与 @shared/yolo 的约定名一致：
 *   face-detect.onnx    （别名 face-detector / blazeface）
 *   face-landmark.onnx  （别名 face-landmarks / facemesh / face-mesh）
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** tag 在 @shared/yoloCatalog 的 YOLO_FACE_CATALOG_BASE_URL 里必须一致 */
const DEFAULT_TAG = 'face-models-v1'

/** 期望的两个条目：id、最小体积（与 catalog / check-pack-resources 的 minBytes 对齐）、说明 */
const EXPECTED = [
  { id: 'face-detect', minBytes: 256 * 1024, note: 'BlazeFace short-range detector' },
  { id: 'face-landmark', minBytes: 256 * 1024, note: 'MediaPipe FaceMesh (468 landmarks)' }
]

function parseArgs(argv) {
  const out = { dir: '', tag: DEFAULT_TAG, upload: false, repo: '' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dir') out.dir = argv[++i] ?? ''
    else if (arg === '--tag') out.tag = argv[++i] ?? DEFAULT_TAG
    else if (arg === '--repo') out.repo = argv[++i] ?? ''
    else if (arg === '--upload') out.upload = true
    else if (arg === '--help' || arg === '-h') out.help = true
  }
  return out
}

function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** 在 --dir 里找这个角色对应的文件：约定名优先，其次按名字特征认（与主进程同一套口径） */
async function resolveFile(dir, entry) {
  const files = (await readdir(dir)).filter((name) => name.toLowerCase().endsWith('.onnx'))
  const exact = files.find((name) => name === `${entry.id}.onnx`)
  if (exact) return { file: exact, via: 'exact name' }

  const patterns =
    entry.id === 'face-detect'
      ? { affinity: /detect|blaze/, foreign: /landmark|mesh/ }
      : // 关键点侧只排除「裸检测器」命名：blazeface-landmarks 这类带前缀的应当能认出（与主进程同口径）
        { affinity: /landmark|mesh/, foreign: /^(?:blazeface|face-detect|face-detector)$/ }
  const hit = files.find((name) => {
    const lower = name.toLowerCase()
    return patterns.affinity.test(lower) && !patterns.foreign.test(lower)
  })
  return hit ? { file: hit, via: 'name pattern' } : null
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.dir) {
    console.log(
      'Usage: node scripts/sync-face-models.mjs --dir <folder-with-face-onnx> [--tag <tag>] [--repo <owner/repo>] [--upload]'
    )
    console.log(`\nExpected files (name = model id), tag = ${args.tag}:`)
    for (const entry of EXPECTED) {
      console.log(`  ${entry.id}.onnx   min ${mb(entry.minBytes)}   ${entry.note}`)
    }
    process.exit(args.help ? 0 : 1)
  }

  const results = []
  for (const entry of EXPECTED) {
    const found = await resolveFile(args.dir, entry)
    if (!found) {
      console.error(`  ! ${entry.id}.onnx not found in ${args.dir}`)
      process.exitCode = 1
      continue
    }
    const abs = join(args.dir, found.file)
    const info = await stat(abs)
    if (info.size < entry.minBytes) {
      console.error(`  ! ${found.file} looks truncated (${info.size} bytes)`)
      process.exitCode = 1
      continue
    }
    const sha = await sha256File(abs)
    results.push({ entry, file: found.file, abs, size: info.size, sha, via: found.via })
    console.log(`  + ${entry.id}.onnx  <-  ${found.file}  (${found.via})`)
    console.log(`      size   ${mb(info.size)}`)
    console.log(`      sha256 ${sha}`)
  }

  if (results.length !== EXPECTED.length) {
    console.error('\nBoth files are required; fix the above and re-run.')
    process.exit(1)
  }

  const repo = args.repo || 'Justin-sky/ai-art-engine'
  console.log(`\nRelease URLs (tag ${args.tag}, repo ${repo}):`)
  for (const item of results) {
    console.log(`  https://github.com/${repo}/releases/download/${args.tag}/${item.entry.id}.onnx`)
  }
  console.log(
    `\nDrop the two .onnx into ${join(PROJECT_ROOT, 'resources', 'face-models')} (or use --upload)\n` +
      'so that `npm run fetch:yolo-models` finds them and they ship inside the installer.'
  )

  console.log('\nPaste into src/shared/yoloCatalog.ts -> RAW_FACE_ENTRIES:')
  for (const item of results) {
    const approx = (item.size / 1024 / 1024).toFixed(1)
    console.log(
      `  { id: '${item.entry.id}', approxMb: ${approx}, minBytes: ${item.entry.minBytes}, sha256: '${item.sha}' },`
    )
  }

  if (args.upload) {
    console.log(`\nUploading to release ${args.tag} (needs the gh CLI, authenticated)...`)
    try {
      execFileSync('gh', ['release', 'view', args.tag], { stdio: 'ignore' })
      console.log(`  = release ${args.tag} already exists`)
    } catch {
      execFileSync(
        'gh',
        [
          'release',
          'create',
          args.tag,
          '--title',
          `Face models ${args.tag}`,
          '--notes',
          'BlazeFace short-range detector + MediaPipe FaceMesh (468 landmarks) exported to ONNX. Consumed by the YOLO face pipeline; exact SHA-256 values are pinned in src/shared/yoloCatalog.ts.'
        ],
        { stdio: 'inherit' }
      )
    }
    for (const item of results) {
      console.log(`  ^ ${item.entry.id}.onnx`)
      execFileSync('gh', ['release', 'upload', args.tag, item.abs, '--clobber'], {
        stdio: 'inherit'
      })
    }
    console.log('Done. Fill the sha256 values above into yoloCatalog, then re-run npm test.')
  } else {
    console.log(
      '\nNext: create/upload the release (add --upload, or upload the two files by hand),'
    )
    console.log('then paste the two entries above into yoloCatalog.ts and run npm test.')
  }
}

main().catch((err) => {
  console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
